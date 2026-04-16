# Voice-to-Text for Cards & Comments

## Context

Users need a faster way to triage tickets and add comments. This adds voice recording + transcription to the Lexxy rich text editor in card descriptions and comments. Audio is recorded via browser MediaRecorder API, uploaded through ActiveStorage DirectUpload, transcribed server-side (local Whisper binary or OpenAI API), and both the transcript text and audio attachment are inserted into the editor.

Key constraints:
- Importmap-only (no npm) — use browser APIs directly
- Lexxy editor (not Trix) — uses `<lexxy-editor>` web component with `.value` getter/setter
- Audio already renders in ActionText — `app/views/active_storage/blobs/web/_representation.html.erb` has `<audio controls>` for `blob.audio?`
- Icons use CSS mask-image pattern with SVGs in `app/assets/images/`

---

## Phase 1: Backend — Transcription Service

### 1. `app/models/voice_transcription/configuration.rb` (new)
- `available?` — true if `VTT_WHISPER_PATH` or `VTT_OPENAI_KEY` env var is set
- `strategy` — `:whisper_local` (priority) or `:openai`
- Accessor methods for each env var

### 2. `app/models/voice_transcription/transcriber.rb` (new)
- Accepts `ActiveStorage::Blob`, validates size (25MB max) and content type
- Delegates to strategy class based on `Configuration#strategy`
- Returns transcribed text string

### 3. `app/models/voice_transcription/whisper_local.rb` (new)
- Downloads blob to tempfile via `blob.open`
- Shells out to whisper binary with `Open3.capture3` (`--output-format txt`)
- 120-second timeout, error handling on non-zero exit
- Reference pattern: `app/models/webhook/delivery.rb` for error handling style

### 4. `app/models/voice_transcription/openai_whisper.rb` (new)
- POST multipart to `https://api.openai.com/v1/audio/transcriptions`
- Manual multipart form encoding via `Net::HTTP` (no gem — matches existing `webhook/delivery.rb` pattern)
- Model: `whisper-1`, response_format: `text`
- 60-second timeout, Bearer token auth

### 5. `app/controllers/voice_transcriptions_controller.rb` (new)
- Single `create` action, accepts `{ blob_signed_id: "..." }` as JSON
- Finds blob via `ActiveStorage::Blob.find_signed!`
- Calls `VoiceTranscription::Transcriber.new(blob).transcribe`
- Returns JSON: `{ text:, blob_sgid:, content_type:, filename:, byte_size: }`
- `blob_sgid` from `blob.attachable_sgid` — used by frontend to build `<action-text-attachment>` tag
- Error cases return `{ error: }` with 422

### 6. `config/routes.rb` (modify)
- Add `resources :voice_transcriptions, only: :create` near `resource :search` (line 128)

### 7. `app/helpers/voice_transcription_helper.rb` (new)
- `voice_transcription_available?` — checks `VoiceTranscription::Configuration.new.available?`

---

## Phase 2: Frontend — Stimulus Controller

### 8. `app/javascript/controllers/voice_recorder_controller.js` (new)

**Targets:** `editor`, `recordButton`, `overlay`, `timer`, `recordingControls`, `playbackControls`, `processingControls`

**Values:** `transcriptionUrl` (String), `directUploadUrl` (String), `maxDuration` (Number, default 300)

**State machine:** idle → recording → (paused) → stopped → uploading → transcribing → idle

**Key methods:**
- `start()` — `getUserMedia({ audio: true })`, create `MediaRecorder` (webm/opus, fallback webm, fallback mp4 for Safari), collect chunks, start timer, show overlay
- `pause()` / `resume()` — toggle MediaRecorder state + timer
- `stop()` — stop MediaRecorder, assemble Blob, show playback controls
- `play()` — `new Audio(URL.createObjectURL(blob))`, play with stop button
- `discard()` — discard blob, stop tracks, hide overlay, reset
- `submit()` — upload via `DirectUpload` from `@rails/activestorage` (already pinned), POST signed_id to transcription endpoint via `post` from `@rails/request.js` (already pinned, used in `card_hotkeys_controller.js`), insert text + attachment into editor
- `toggleRecording()` — for keyboard shortcut: start if idle, stop if recording
- `#insertIntoEditor(text, sgid, contentType, filename, byteSize)` — read editor `.value`, append `<p>` tags for transcript + `<action-text-attachment sgid="..." ...>` tag, set `.value`, dispatch `lexxy:change` event for auto-save/local-save integration
- `disconnect()` — cleanup media tracks, revoke URLs, clear intervals

**Error handling:** permission denied notification, MediaRecorder unsupported (hide button), upload/transcription failure (show error with retry, keep audio intact)

---

## Phase 3: Views & UI

### 9. `app/views/voice_transcriptions/_recorder.html.erb` (new)
Recording overlay partial with three mutually-exclusive control groups:
- **Recording:** timer display, pause/resume button, stop button, discard button
- **Playback:** play button, discard button, transcribe/submit button  
- **Processing:** spinner + status text ("Uploading..." / "Transcribing...")

### 10. `app/views/cards/container/_content.html.erb` (modify — lines 12-28)
- Wrap the `else` branch form in a div with `data-controller="voice-recorder"` + value attrs (only when `voice_transcription_available?`)
- Add `data-voice-recorder-target="editor"` to the `rich_textarea` (line 23)
- Add microphone button + recorder partial after the form

### 11. `app/views/cards/edit.html.erb` (modify — lines 9-27)
- Wrap form in voice-recorder controller div (when available)
- Add editor target to `rich_textarea` (line 19)
- Add microphone button + recorder partial

### 12. `app/views/cards/comments/_new.html.erb` (modify — lines 7-25)
- Add voice-recorder controller to the `comment__body` div (line 7)
- Add editor target to `rich_textarea` (line 12)
- Add microphone button in the `span.flex-inline` (line 17) next to Post button

### 13. `app/views/cards/comments/edit.html.erb` (modify — lines 8-28)
- Add voice-recorder controller to `comment__body` div
- Add editor target to `rich_textarea` (line 11)
- Add microphone button in the controls div (line 14)

---

## Phase 4: Icons & Styles

### 14. New SVG icons in `app/assets/images/` (new)
- `microphone.svg` — for the record button
- `stop-circle.svg` — for stop recording
- `play-circle.svg` — for playback  
- `pause-circle.svg` — for pause recording

(Reuse existing `trash.svg` for discard, `close.svg` for dismiss)

### 15. `app/assets/stylesheets/icons.css` (modify)
Add icon definitions:
```css
.icon--microphone { --svg: url("microphone.svg"); }
.icon--stop-circle { --svg: url("stop-circle.svg"); }
.icon--play-circle { --svg: url("play-circle.svg"); }
.icon--pause-circle { --svg: url("pause-circle.svg"); }
```

### 16. `app/assets/stylesheets/voice_recorder.css` (new)
- `.voice-recorder__trigger` — microphone button styling
- `.voice-recorder` — overlay container (relative to editor)
- `.voice-recorder__timer` — monospace, centered timer display
- `.voice-recorder__controls` — flex row with gap
- `.voice-recorder--recording` — pulsing red dot animation
- `.voice-recorder__spinner` — CSS-only loading spinner

### 17. Import in stylesheet manifest
Add `voice_recorder.css` to the main stylesheet import.

---

## Phase 5: Keyboard Shortcut

### 18. Shortcut binding on voice-recorder controller element
- `Shift+Alt+V` via Stimulus action descriptor: `keydown.shift+alt+v@window->voice-recorder#toggleRecording`
- Does NOT skip when focused in editor (unlike card_hotkeys which skips in lexxy-editor)

---

## Configuration

| Env Var | Purpose | Priority |
|---------|---------|----------|
| `VTT_WHISPER_PATH` | Path to local Whisper binary | 1st (preferred) |
| `VTT_OPENAI_KEY` | OpenAI API key for Whisper API | 2nd (fallback) |

If neither is set, the microphone button is hidden entirely.

---

## Verification

1. **Unit tests:** `test/models/voice_transcription/` — test Configuration, Transcriber, WhisperLocal, OpenaiWhisper with mocked HTTP/shell
2. **Controller test:** `test/controllers/voice_transcriptions_controller_test.rb` — test create with valid/invalid blob
3. **System test:** Manual via Chrome MCP — set `VTT_OPENAI_KEY` or `VTT_WHISPER_PATH`, create a card, click microphone, record, verify transcript appears in editor with audio attachment
4. **Run `bin/rails test`** for unit tests, **`bin/ci`** for full suite
