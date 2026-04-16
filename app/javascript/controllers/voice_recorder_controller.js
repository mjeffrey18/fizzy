import { Controller } from "@hotwired/stimulus"
import { DirectUpload } from "@rails/activestorage"
import { post } from "@rails/request.js"

export default class extends Controller {
  static targets = [
    "recordButton", "overlay", "timer", "statusText",
    "recordingControls", "playbackControls", "processingControls"
  ]

  static values = {
    transcriptionUrl: String,
    directUploadUrl: String,
    maxDuration: { type: Number, default: 300 }
  }

  connect() {
    this.#state = "idle"
    this.#chunks = []
    this.#mediaRecorder = null
    this.#mediaStream = null
    this.#audioBlob = null
    this.#audioElement = null
    this.#timerInterval = null
    this.#elapsedSeconds = 0

    if (!window.MediaRecorder) {
      this.recordButtonTarget.hidden = true
    }
  }

  disconnect() {
    this.#cleanup()
  }

  async start() {
    if (this.#state !== "idle") return

    try {
      this.#mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      this.#showError("Microphone access denied. Please allow microphone access and try again.")
      return
    }

    const mimeType = this.#preferredMimeType()
    this.#mediaRecorder = new MediaRecorder(this.#mediaStream, mimeType ? { mimeType } : {})
    this.#chunks = []

    this.#mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.#chunks.push(event.data)
    }

    this.#mediaRecorder.onstop = () => {
      this.#audioBlob = new Blob(this.#chunks, { type: this.#mediaRecorder.mimeType })
      this.#transitionTo("stopped")
    }

    this.#mediaRecorder.start(1000)
    this.#startTimer()
    this.#transitionTo("recording")
  }

  pause() {
    if (this.#state !== "recording") return

    this.#mediaRecorder.pause()
    this.#stopTimer()
    this.#transitionTo("paused")
  }

  resume() {
    if (this.#state !== "paused") return

    this.#mediaRecorder.resume()
    this.#startTimer()
    this.#transitionTo("recording")
  }

  stop() {
    if (this.#state !== "recording" && this.#state !== "paused") return

    this.#mediaRecorder.stop()
    this.#stopTimer()
    this.#stopMediaTracks()
  }

  play() {
    if (!this.#audioBlob) return

    this.#stopPlayback()
    this.#audioElement = new Audio(URL.createObjectURL(this.#audioBlob))
    this.#audioElement.onended = () => this.#transitionTo("stopped")
    this.#audioElement.play()
    this.#transitionTo("playing")
  }

  stopPlayback() {
    this.#stopPlayback()
    this.#transitionTo("stopped")
  }

  discard() {
    this.#cleanup()
    this.#transitionTo("idle")
  }

  async submit() {
    if (!this.#audioBlob) return

    this.#transitionTo("uploading")

    try {
      const extension = this.#extensionForMimeType(this.#audioBlob.type)
      const file = new File(
        [this.#audioBlob],
        `voice-recording-${Date.now()}.${extension}`,
        { type: this.#audioBlob.type }
      )

      const signedId = await this.#upload(file)

      this.#transitionTo("transcribing")

      const response = await post(this.transcriptionUrlValue, {
        body: JSON.stringify({ blob_signed_id: signedId }),
        contentType: "application/json",
        responseKind: "json"
      })

      if (!response.ok) {
        const body = await response.json
        throw new Error(body?.error || "Transcription failed")
      }

      const data = await response.json
      this.#insertIntoEditor(data.text, data.blob_sgid, data.content_type, data.filename, data.byte_size)
      this.#cleanup()
      this.#transitionTo("idle")
    } catch (error) {
      this.#showError(error.message || "Something went wrong. Please try again.")
      this.#transitionTo("stopped")
    }
  }

  toggleRecording(event) {
    if (this.#state === "idle") {
      event.preventDefault()
      this.start()
    } else if (this.#state === "recording" || this.#state === "paused") {
      event.preventDefault()
      this.stop()
    }
  }

  // Private

  #state
  #chunks
  #mediaRecorder
  #mediaStream
  #audioBlob
  #audioElement
  #timerInterval
  #elapsedSeconds

  #transitionTo(state) {
    this.#state = state
    this.overlayTarget.hidden = state === "idle"
    this.recordButtonTarget.hidden = state !== "idle"

    if (this.hasRecordingControlsTarget) {
      this.recordingControlsTarget.hidden = state !== "recording" && state !== "paused"
    }
    if (this.hasPlaybackControlsTarget) {
      this.playbackControlsTarget.hidden = state !== "stopped" && state !== "playing"
    }
    if (this.hasProcessingControlsTarget) {
      this.processingControlsTarget.hidden = state !== "uploading" && state !== "transcribing"
    }

    this.#updateStatusText(state)
    this.#updatePauseResumeButton(state)
    this.#updatePlayStopButton(state)
  }

  #updateStatusText(state) {
    if (!this.hasStatusTextTarget) return

    const messages = {
      recording: "Recording...",
      paused: "Paused",
      stopped: "Recording complete",
      playing: "Playing...",
      uploading: "Uploading audio...",
      transcribing: "Transcribing..."
    }
    this.statusTextTarget.textContent = messages[state] || ""
  }

  #updatePauseResumeButton(state) {
    const btn = this.element.querySelector("[data-voice-recorder-pause-resume]")
    if (!btn) return

    if (state === "paused") {
      btn.querySelector(".icon")?.classList.replace("icon--pause-circle", "icon--play-circle")
      btn.setAttribute("data-action", "voice-recorder#resume")
      btn.title = "Resume"
    } else {
      btn.querySelector(".icon")?.classList.replace("icon--play-circle", "icon--pause-circle")
      btn.setAttribute("data-action", "voice-recorder#pause")
      btn.title = "Pause"
    }
  }

  #updatePlayStopButton(state) {
    const btn = this.element.querySelector("[data-voice-recorder-play-stop]")
    if (!btn) return

    if (state === "playing") {
      btn.querySelector(".icon")?.classList.replace("icon--play-circle", "icon--stop-circle")
      btn.setAttribute("data-action", "voice-recorder#stopPlayback")
      btn.title = "Stop"
    } else {
      btn.querySelector(".icon")?.classList.replace("icon--stop-circle", "icon--play-circle")
      btn.setAttribute("data-action", "voice-recorder#play")
      btn.title = "Play"
    }
  }

  #insertIntoEditor(text, sgid, contentType, filename, byteSize) {
    const editor = this.element.querySelector("lexxy-editor")
    if (!editor) return

    const paragraphs = text.split(/\n+/).filter(Boolean).map(p => `<p>${p}</p>`).join("")
    const attachment = `<action-text-attachment sgid="${sgid}" content-type="${contentType}" filename="${filename}" byte-size="${byteSize}"></action-text-attachment>`

    const existingContent = editor.value || ""
    const newContent = existingContent + paragraphs + attachment
    editor.value = newContent

    editor.dispatchEvent(new CustomEvent("lexxy:change", { bubbles: true }))
  }

  #upload(file) {
    return new Promise((resolve, reject) => {
      const upload = new DirectUpload(file, this.directUploadUrlValue)
      upload.create((error, blob) => {
        if (error) {
          reject(new Error("Upload failed. Please try again."))
        } else {
          resolve(blob.signed_id)
        }
      })
    })
  }

  #startTimer() {
    this.#timerInterval = setInterval(() => {
      this.#elapsedSeconds++

      if (this.#elapsedSeconds >= this.maxDurationValue) {
        this.stop()
        return
      }

      this.#updateTimerDisplay()
    }, 1000)
  }

  #stopTimer() {
    if (this.#timerInterval) {
      clearInterval(this.#timerInterval)
      this.#timerInterval = null
    }
  }

  #updateTimerDisplay() {
    if (!this.hasTimerTarget) return

    const minutes = Math.floor(this.#elapsedSeconds / 60)
    const seconds = this.#elapsedSeconds % 60
    this.timerTarget.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
  }

  #stopPlayback() {
    if (this.#audioElement) {
      this.#audioElement.pause()
      URL.revokeObjectURL(this.#audioElement.src)
      this.#audioElement = null
    }
  }

  #stopMediaTracks() {
    if (this.#mediaStream) {
      this.#mediaStream.getTracks().forEach(track => track.stop())
      this.#mediaStream = null
    }
  }

  #cleanup() {
    this.#stopTimer()
    this.#stopPlayback()
    this.#stopMediaTracks()

    if (this.#mediaRecorder && this.#mediaRecorder.state !== "inactive") {
      this.#mediaRecorder.stop()
    }

    this.#mediaRecorder = null
    this.#audioBlob = null
    this.#chunks = []
    this.#elapsedSeconds = 0

    if (this.hasTimerTarget) {
      this.timerTarget.textContent = "00:00"
    }
  }

  #preferredMimeType() {
    const types = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4"
    ]
    return types.find(type => MediaRecorder.isTypeSupported(type))
  }

  #extensionForMimeType(mimeType) {
    if (mimeType.includes("webm")) return "webm"
    if (mimeType.includes("mp4")) return "mp4"
    if (mimeType.includes("ogg")) return "ogg"
    return "webm"
  }

  #showError(message) {
    if (this.hasStatusTextTarget) {
      this.statusTextTarget.textContent = message
      this.statusTextTarget.classList.add("voice-recorder__error")
      setTimeout(() => {
        this.statusTextTarget.classList.remove("voice-recorder__error")
      }, 5000)
    }
  }
}
