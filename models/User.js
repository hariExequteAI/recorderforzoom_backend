const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const userSchema = new mongoose.Schema({
  username: { type: String, required: true },
  email:    { type: String, required: true, unique: true },
  password: { type: String, required: true }, // hashed
  companyId:{ type: String, required: true }, // simple string/slug for company
  phone:    { type: String },
  role:     { type: String, enum: ["admin", "agent"], default: "agent" }
}, { timestamps: true });

userSchema.pre("save", async function(next){
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = function(plain){
  return bcrypt.compare(plain, this.password);
};

module.exports = mongoose.model("User", userSchema);
