class VoiceTranscription::Transcriber
  MAX_AUDIO_SIZE = 25.megabytes
  SUPPORTED_CONTENT_TYPES = %w[
    audio/webm audio/ogg audio/mp4 audio/wav audio/mpeg audio/mp3
  ].freeze

  class Error < StandardError; end
  class UnsupportedFormat < Error; end
  class FileTooLarge < Error; end
  class NotConfigured < Error; end

  attr_reader :blob

  def initialize(blob)
    @blob = blob
  end

  def transcribe
    validate!
    strategy.new(blob).transcribe
  end

  private
    def validate!
      raise NotConfigured, "No transcription provider configured" unless configuration.available?
      raise FileTooLarge, "Audio file exceeds #{MAX_AUDIO_SIZE / 1.megabyte}MB limit" if blob.byte_size > MAX_AUDIO_SIZE
      raise UnsupportedFormat, "Unsupported audio format: #{blob.content_type}" unless SUPPORTED_CONTENT_TYPES.include?(blob.content_type)
    end

    def strategy
      case configuration.strategy
      when :whisper_local then VoiceTranscription::WhisperLocal
      when :openai        then VoiceTranscription::OpenaiWhisper
      end
    end

    def configuration
      @configuration ||= VoiceTranscription::Configuration.new
    end
end
