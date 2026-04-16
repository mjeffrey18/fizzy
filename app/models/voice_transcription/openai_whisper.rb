class VoiceTranscription::OpenaiWhisper
  ENDPOINT = URI("https://api.openai.com/v1/audio/transcriptions")
  TIMEOUT = 60
  MODEL = "whisper-1"

  attr_reader :blob

  def initialize(blob)
    @blob = blob
  end

  def transcribe
    blob.open(tmpdir: Dir.tmpdir) do |tempfile|
      response = post_multipart(tempfile)

      unless response.is_a?(Net::HTTPSuccess)
        raise VoiceTranscription::Transcriber::Error,
          "OpenAI Whisper API error (#{response.code}): #{response.body.truncate(500)}"
      end

      response.body.strip
    end
  end

  private
    def post_multipart(file)
      boundary = SecureRandom.hex(16)

      request = Net::HTTP::Post.new(ENDPOINT)
      request["Authorization"] = "Bearer #{api_key}"
      request["Content-Type"] = "multipart/form-data; boundary=#{boundary}"
      request.body = build_multipart_body(file, boundary)

      http = Net::HTTP.new(ENDPOINT.host, ENDPOINT.port)
      http.use_ssl = true
      http.open_timeout = TIMEOUT
      http.read_timeout = TIMEOUT
      http.request(request)
    end

    def build_multipart_body(file, boundary)
      parts = []

      parts << "--#{boundary}\r\n"
      parts << "Content-Disposition: form-data; name=\"file\"; filename=\"#{blob.filename}\"\r\n"
      parts << "Content-Type: #{blob.content_type}\r\n\r\n"
      parts << file.read
      parts << "\r\n"

      parts << "--#{boundary}\r\n"
      parts << "Content-Disposition: form-data; name=\"model\"\r\n\r\n"
      parts << MODEL
      parts << "\r\n"

      parts << "--#{boundary}\r\n"
      parts << "Content-Disposition: form-data; name=\"response_format\"\r\n\r\n"
      parts << "text"
      parts << "\r\n"

      parts << "--#{boundary}--\r\n"
      parts.join
    end

    def api_key
      VoiceTranscription::Configuration.new.openai_key
    end
end
