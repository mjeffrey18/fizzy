module VoiceTranscriptionHelper
  def voice_transcription_available?
    VoiceTranscription::Configuration.new.available?
  end
end
