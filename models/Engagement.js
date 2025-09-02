const mongoose = require("mongoose");

const engagementSchema = new mongoose.Schema(
  {
    companyId: { type: String, index: true },
    engagementId: { type: String, unique: true, required: true },
    direction: { type: String, default: "" },       // inbound/outbound
    startTime: { type: Date, default: Date.now },
    duration: { type: Number, default: 0 },         // total duration in seconds
    waitingDuration: { type: Number, default: 0 },  // waiting time in seconds
    handlingDuration: { type: Number, default: 0 }, // handling time in seconds
    wrapUpDuration: { type: Number, default: 0 },   // wrap-up time in seconds
    agent: { type: String, default: "" },
    accept_type: { type: String, default: "" },
    upgraded_to_channel_type: { type: String, default: "" },
    transfer_type: { type: String, default: "" },
    queue: { type: String, default: "" },
    channel: { type: String, default: "" },         // voice, chat, etc.
    flow: { type: String, default: "" },
    disposition: { type: String, default: "" },
    consumer: { type: String, default: "" },        // customer name
    source: { type: String, default: "" },          // source info
    notes: { type: String, default: "" },
    transcript: [
    {
      speaker: String,
      time: String,
      text: String,
    },
  ],
    voicemail: { type: Boolean, default: false },
    recordingConsent: { type: Boolean, default: false },
    recordingUrl: { type: String, default: "" },    // Zoom download URL
    localPath: { type: String, default: "" },       // local saved path
    publicUrl: { type: String, default: "" },  
       
  },
  { timestamps: true }
);

module.exports = mongoose.model("Engagement", engagementSchema);
