// Import & Setup
require('dotenv').config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const path = require("path");
const bodyParser = require("body-parser");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const app = express();
const PORT = process.env.PORT || 5500;

// Middleware
app.use(cors({
  origin: "https://medication-stock.onrender.com" // Your deployed frontend
}));
app.use(bodyParser.json());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/medicationdb', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log("✅ MongoDB connected"))
.catch(err => console.error("❌ MongoDB connection error:", err));

// Schemas and Models
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  resetToken: String,
  resetTokenExpiry: Date
});
const User = mongoose.model("User", userSchema);

const MedicationSchema = new mongoose.Schema({
  name: String,
  dosage: String,
  quantity: Number,
  batchNumber: String,
  expirationDate: Date,
  sold: { type: Number, default: 0 }
});
const Medication = mongoose.model("Medication", MedicationSchema);

// Nodemailer Setup
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// ROUTES

// Signup
app.post("/signup", async (req, res) => {
  const { email, password } = req.body;
  try {
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: "User already exists" });

    const hashed = await bcrypt.hash(password, 10);
    const user = new User({ email, password: hashed });
    await user.save();
    res.status(201).json({ message: "Signup successful", userId: user._id, email: user.email });
  } catch (err) {
    res.status(500).json({ message: "Error", error: err.message });
  }
});

// Login
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "User not found" });

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return res.status(400).json({ message: "Invalid credentials" });

    res.status(200).json({ message: "Login successful", userId: user._id, email: user.email });
  } catch (err) {
    res.status(500).json({ message: "Error", error: err.message });
  }
});

// Send Reset Link via Email
app.post("/send-reset-link", async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    const token = crypto.randomBytes(32).toString("hex");
    user.resetToken = token;
    user.resetTokenExpiry = Date.now() + 60 * 60 * 1000;
    await user.save();

    const link = `https://medication-stock.onrender.com/reset.html?token=${token}`;

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Reset your password",
      html: `<p>Click the link to reset your password:</p><a href="${link}">${link}</a>`
    });

    res.status(200).json({ message: "Reset link sent!" });
  } catch (err) {
    res.status(500).json({ message: "Failed to send email", error: err.message });
  }
});

// Reset Password
app.post("/reset-password", async (req, res) => {
  const { token, newPassword } = req.body;
  try {
    const user = await User.findOne({ resetToken: token, resetTokenExpiry: { $gt: Date.now() } });
    if (!user) return res.status(400).json({ message: "Invalid or expired token" });

    user.password = await bcrypt.hash(newPassword, 10);
    user.resetToken = undefined;
    user.resetTokenExpiry = undefined;
    await user.save();

    res.status(200).json({ message: "Password updated!" });
  } catch (err) {
    res.status(500).json({ message: "Failed to reset password", error: err.message });
  }
});

// Add Medication
app.post('/api/medications/add', async (req, res) => {
  try {
    const newMed = new Medication(req.body);
    await newMed.save();
    res.status(201).json({ message: 'Medication added' });
  } catch (err) {
    res.status(500).json({ error: 'Error adding medication' });
  }
});

// Get Inventory
app.get('/api/medications/inventory', async (req, res) => {
  try {
    const meds = await Medication.find();
    res.json(meds);
  } catch (err) {
    res.status(500).json({ error: 'Error fetching medications' });
  }
});

// Total Available Quantity
app.get('/api/medications/total', async (req, res) => {
  try {
    const meds = await Medication.find({});
    const total = meds.reduce((sum, med) => sum + (med.quantity || 0), 0);
    res.json({ total });
  } catch (err) {
    res.status(500).json({ error: 'Error fetching total available quantity' });
  }
});

// Total Sold
app.get('/api/medications/sold', async (req, res) => {
  try {
    const meds = await Medication.find();
    const totalSold = meds.reduce((sum, med) => sum + (med.sold || 0), 0);
    res.json({ totalSold });
  } catch (err) {
    res.status(500).json({ error: 'Fetch failed' });
  }
});

// Summary
app.get('/api/medications/summary', async (req, res) => {
  try {
    const meds = await Medication.find();
    const totalSold = meds.reduce((sum, med) => sum + (med.sold || 0), 0);
    const totalAvailable = meds.reduce((sum, med) => sum + (med.quantity || 0), 0);
    res.json({ totalSold, totalAvailable });
  } catch (err) {
    res.status(500).json({ error: 'Fetch failed' });
  }
});

// Get by ID
app.get('/api/medications/:id', async (req, res) => {
  try {
    const med = await Medication.findById(req.params.id);
    if (!med) return res.status(404).json({ message: 'Medication not found' });
    res.json(med);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Update
app.put('/api/medications/:id', async (req, res) => {
  const { sold, quantity } = req.body;
  try {
    const med = await Medication.findById(req.params.id);
    if (!med) return res.status(404).json({ message: 'Not found' });

    med.sold = parseInt(sold);
    med.quantity = parseInt(quantity);

    if (med.quantity <= 0) {
      await med.deleteOne();
      return res.json({ message: 'Medication removed due to zero quantity' });
    }

    const updated = await med.save();
    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: 'Error updating medication' });
  }
});

// Delete
app.delete('/api/medications/:id', async (req, res) => {
  try {
    const result = await Medication.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Error deleting medication' });
  }
});

// Expired Medications
app.get('/api/expired-medications', async (req, res) => {
  try {
    const today = new Date();
    const expired = await Medication.find({ expirationDate: { $lt: today } });
    res.json(expired);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching expired medications' });
  }
});

// Chart Data
app.get('/api/medications/chart-data', async (req, res) => {
  try {
    const medications = await Medication.find({}, 'name quantity sold');
    const chartData = medications.map(med => ({
      name: med.name,
      quantity: med.quantity || 0,
      sold: med.sold || 0
    }));
    res.json(chartData);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch chart data' });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
