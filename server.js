require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");
const bcrypt = require("./node_modules/bcryptjs/umd");
const nodemailer = require("nodemailer");
const crypto = require("crypto");

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const uri = process.env.MONGO_URI;
const client = new MongoClient(uri);
// Backend API route for the admin reset functionality
// This needs to be added to your backend server code

// Add this route to your backend server (Node.js/Express example)
/**
 * Route to reset the database (delete all users)
 * 
 * @route POST /admin/reset-database
 * @access Private (Admin Only)
 */
app.post('/admin/reset-database', async (req, res) => {
  try {
      const { adminKey } = req.body;
      
      // Verify admin key
      if (!adminKey || adminKey !== process.env.ADMIN_SECRET_KEY) {
          return res.status(401).json({
              success: false,
              message: 'অননুমোদিত অ্যাক্সেস। এডমিন অনুমতি নেই।'
          });
      }
      
      // Delete all users from the database
      await User.deleteMany({});
      
      // Optionally, delete any related collections like sessions, profiles, etc.
      // For example: await Session.deleteMany({});
      
      return res.status(200).json({
          success: true,
          message: 'সমস্ত ইউজার ডাটা সফলভাবে মুছে ফেলা হয়েছে।'
      });
  } catch (error) {
      console.error('Database reset error:', error);
      return res.status(500).json({
          success: false,
          message: 'সার্ভার ত্রুটি। ডাটাবেস রিসেট করতে ব্যর্থ হয়েছে।'
      });
  }
});
// In-memory OTP storage (for demo purposes - in production, use database)
const otpStore = {};

async function connectDB() {
  try {
    await client.connect();
    console.log("✅ Connected to MongoDB");
    
    const db = client.db("userAuth");
    const users = db.collection("users");
    const otpCollection = db.collection("otps");
    
    // Create indexes for better performance and unique constraints
    await users.createIndex({ email: 1 }, { unique: true });
    await otpCollection.createIndex({ createdAt: 1 }, { expireAfterSeconds: 300 }); // OTPs expire after 5 minutes
    
    // Configure email transporter
    const transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
    
    // Send OTP email function
    async function sendOtpEmail(email, otp) {
      try {
        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: email,
          subject: "আপনার রেজিস্ট্রেশন অটিপি কোড",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px;">
              <h2>রেজিস্ট্রেশন অটিপি কোড</h2>
              <p>প্রিয় ব্যবহারকারী,</p>
              <p>আপনার অ্যাকাউন্ট নিবন্ধন করার জন্য ধন্যবাদ। আপনার অটিপি কোড হল:</p>
              <div style="background-color: #f4f4f4; padding: 10px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px; margin: 20px 0;">
                ${otp}
              </div>
              <p>এই কোডটি ২ মিনিটের জন্য বৈধ থাকবে।</p>
              <p>যদি আপনি এই অনুরোধ না করে থাকেন, তাহলে এই ইমেইল উপেক্ষা করুন।</p>
              <p>ধন্যবাদান্তে,<br>আপনার টিম</p>
            </div>
          `
        };
        
        await transporter.sendMail(mailOptions);
        console.log(`✅ OTP sent to ${email}`);
        return true;
      } catch (error) {
        console.error("❌ Failed to send OTP:", error);
        return false;
      }
    }
    
    // Generate OTP function
    function generateOTP() {
      return Math.floor(1000 + Math.random() * 9000).toString();
    }

    // Middleware to check if user exists
    async function userExists(req, res, next) {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ success: false, message: "ইমেইল প্রদান করুন" });
      }
      
      try {
        const existingUser = await users.findOne({ email });
        req.userExists = !!existingUser;
        next();
      } catch (error) {
        console.error("❌ Error checking user:", error);
        res.status(500).json({ success: false, message: "সার্ভার এরর" });
      }
    }

    // API Routes
    
    // 1. Check if email exists route
    app.post("/check-email", userExists, async (req, res) => {
      const { email } = req.body;
      
      if (req.userExists) {
        return res.json({ success: false, message: "এই ইমেইল দিয়ে একাউন্ট ইতিমধ্যে আছে" });
      }
      
      // Generate OTP
      const otp = generateOTP();
      
      // Store OTP (in database for production)
      await otpCollection.insertOne({
        email,
        otp,
        createdAt: new Date()
      });
      
      // Send OTP email
      const emailSent = await sendOtpEmail(email, otp);
      
      if (emailSent) {
        res.json({ success: true, message: "আপনার ইমেইলে অটিপি পাঠানো হয়েছে" });
      } else {
        res.status(500).json({ success: false, message: "অটিপি পাঠাতে সমস্যা হয়েছে" });
      }
    });
    
    // 2. Verify OTP route
    app.post("/verify-otp", async (req, res) => {
      const { email, otp } = req.body;
      
      if (!email || !otp) {
        return res.status(400).json({ success: false, message: "ইমেইল এবং অটিপি প্রদান করুন" });
      }
      
      try {
        // Check OTP from database
        const otpRecord = await otpCollection.findOne({ email, otp });
        
        if (!otpRecord) {
          return res.json({ success: false, message: "ভুল অটিপি বা অটিপি মেয়াদ শেষ হয়েছে" });
        }
        
        // OTP is valid
        res.json({ success: true, message: "অটিপি যাচাই সফল হয়েছে" });
      } catch (error) {
        console.error("❌ OTP verification error:", error);
        res.status(500).json({ success: false, message: "সার্ভার এরর" });
      }
    });
    
    // 3. Resend OTP route
    app.post("/resend-otp", async (req, res) => {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ success: false, message: "ইমেইল প্রদান করুন" });
      }
      
      try {
        // Delete any existing OTPs for this email
        await otpCollection.deleteMany({ email });
        
        // Generate new OTP
        const otp = generateOTP();
        
        // Store new OTP
        await otpCollection.insertOne({
          email,
          otp,
          createdAt: new Date()
        });
        
        // Send OTP email
        const emailSent = await sendOtpEmail(email, otp);
        
        if (emailSent) {
          res.json({ success: true, message: "নতুন অটিপি পাঠানো হয়েছে" });
        } else {
          res.status(500).json({ success: false, message: "অটিপি পাঠাতে সমস্যা হয়েছে" });
        }
      } catch (error) {
        console.error("❌ Resend OTP error:", error);
        res.status(500).json({ success: false, message: "সার্ভার এরর" });
      }
    });
    
    // 4. Register user route
    app.post("/register", async (req, res) => {
      const { name, email, password } = req.body;
      
      if (!name || !email || !password) {
        return res.status(400).json({ success: false, message: "সকল তথ্য প্রদান করুন" });
      }
      
      try {
        // Check if email already exists
        const existingUser = await users.findOne({ email });
        
        if (existingUser) {
          return res.json({ success: false, message: "এই ইমেইল দিয়ে একাউন্ট ইতিমধ্যে আছে" });
        }
        
        // Check OTP verification status (optional, you can enforce this)
        const otpRecord = await otpCollection.findOne({ email });
        
        if (!otpRecord) {
          return res.json({ success: false, message: "অটিপি যাচাই করা হয়নি" });
        }
        
        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        
        // Create user
        const result = await users.insertOne({
          name,
          email,
          password: hashedPassword,
          createdAt: new Date()
        });
        
        // Clear OTP records for this email
        await otpCollection.deleteMany({ email });
        
        res.json({
          success: true,
          message: "রেজিস্ট্রেশন সফল হয়েছে",
          userId: result.insertedId
        });
      } catch (error) {
        console.error("❌ Registration error:", error);
        res.status(500).json({ success: false, message: "সার্ভার এরর" });
      }
    });
    
    // 5. Login route
    app.post("/login", async (req, res) => {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ success: false, message: "ইমেইল এবং পাসওয়ার্ড প্রদান করুন" });
      }
      
      try {
        // Find user
        const user = await users.findOne({ email });
        
        if (!user) {
          return res.json({ success: false, message: "ভুল ইমেইল বা পাসওয়ার্ড" });
        }
        
        // Verify password
        const isMatch = await bcrypt.compare(password, user.password);
        
        if (!isMatch) {
          return res.json({ success: false, message: "ভুল ইমেইল বা পাসওয়ার্ড" });
        }
        
        // For production, you should generate and return a JWT token here
        // const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1d' });
        
        res.json({
          success: true,
          message: "লগইন সফল হয়েছে",
          user: {
            id: user._id,
            name: user.name,
            email: user.email
          }
          // token: token
        });
      } catch (error) {
        console.error("❌ Login error:", error);
        res.status(500).json({ success: false, message: "সার্ভার এরর" });
      }
    });
    
    // Sample test route
    app.get("/", (req, res) => {
      res.send("সার্ভার চালু আছে! 🚀");
    });
    
    // Start server
    app.listen(port, () => {
      console.log(`🚀 Server running on port ${port}`);
    });
    
  } catch (err) {
    console.error("❌ Database connection error:", err);
  }
}

// Start the server
connectDB();

// Handle server shutdown
process.on('SIGINT', async () => {
  await client.close();
  console.log('MongoDB connection closed');
  process.exit(0);
});