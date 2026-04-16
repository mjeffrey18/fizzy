class VoiceTranscription::Configuration
  def available?
    whisper_path.present? || openai_key.present?
  end

  def strategy
    if whisper_path.present?
      :whisper_local
    elsif openai_key.present?
      :openai
    end
  end

  def whisper_path
    ENV["VTT_WHISPER_PATH"]
  end

  def openai_key
    ENV["VTT_OPENAI_KEY"]
  end
end
