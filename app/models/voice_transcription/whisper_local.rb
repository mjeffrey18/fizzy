class VoiceTranscription::WhisperLocal
  TIMEOUT = 120

  attr_reader :blob

  def initialize(blob)
    @blob = blob
  end

  def transcribe
    blob.open(tmpdir: Dir.tmpdir) do |tempfile|
      output_dir = File.dirname(tempfile.path)
      base_name = File.basename(tempfile.path, File.extname(tempfile.path))

      stdout, stderr, status = Open3.capture3(
        whisper_path,
        tempfile.path,
        "--output-format", "txt",
        "--output-dir", output_dir,
        timeout: TIMEOUT
      )

      unless status.success?
        raise VoiceTranscription::Transcriber::Error, "Whisper transcription failed: #{stderr.truncate(500)}"
      end

      output_file = File.join(output_dir, "#{base_name}.txt")
      unless File.exist?(output_file)
        raise VoiceTranscription::Transcriber::Error, "Whisper output file not found"
      end

      File.read(output_file).strip
    ensure
      output_file = File.join(output_dir, "#{base_name}.txt") if output_dir && base_name
      File.delete(output_file) if output_file && File.exist?(output_file)
    end
  end

  private
    def whisper_path
      VoiceTranscription::Configuration.new.whisper_path
    end
end
