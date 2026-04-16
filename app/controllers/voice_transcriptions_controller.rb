class VoiceTranscriptionsController < ApplicationController
  def create
    blob = ActiveStorage::Blob.find_signed!(params[:blob_signed_id])
    text = VoiceTranscription::Transcriber.new(blob).transcribe

    render json: {
      text: text,
      blob_sgid: blob.attachable_sgid,
      content_type: blob.content_type,
      filename: blob.filename.to_s,
      byte_size: blob.byte_size
    }
  rescue ActiveSupport::MessageVerifier::InvalidSignature
    render json: { error: "Invalid blob" }, status: :unprocessable_entity
  rescue VoiceTranscription::Transcriber::Error => error
    render json: { error: error.message }, status: :unprocessable_entity
  end
end
