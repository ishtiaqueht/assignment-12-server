// server.js
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());

// MongoDB URI (use env variables)
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.4uzxkby.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const db = client.db("eduPulseDB");
    const usersCollection = db.collection("users");
    const sessionsCollection = db.collection("sessions");
    const reviewsCollection = db.collection("reviews");
    const bookedSessionsCollection = db.collection("bookedSessions");

    // ------------------ USERS ------------------

    // Get all users
    app.get("/users", async (req, res) => {
      try {
        const users = await usersCollection.find({}).toArray();
        res.send(users);
      } catch (err) {
        console.error("GET /users error:", err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Search users by email (partial)
    app.get("/users/search", async (req, res) => {
      try {
        const emailQuery = req.query.email || "";
        const regex = new RegExp(emailQuery, "i");
        const users = await usersCollection
          .find({ email: { $regex: regex } })
          .limit(50)
          .toArray();
        res.send(users);
      } catch (err) {
        console.error("GET /users/search error:", err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Get role by email
    app.get("/users/:email/role", async (req, res) => {
      try {
        const email = req.params.email;
        const user = await usersCollection.findOne({ email });
        if (!user) return res.status(404).send({ message: "User not found" });
        res.send({ role: user.role || "student" });
      } catch (err) {
        console.error("GET /users/:email/role error:", err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Add new user (signup)
    app.post("/users", async (req, res) => {
      try {
        const { email, name, photo } = req.body;
        if (!email || !name || !photo) {
          return res.status(400).send({ message: "All fields required" });
        }

        const userExists = await usersCollection.findOne({ email });
        if (userExists) {
          return res
            .status(200)
            .send({ message: "User already exists", inserted: false });
        }

        const newUser = {
          email,
          name,
          photo,
          role: "student",
          createdAt: new Date(),
        };

        const result = await usersCollection.insertOne(newUser);
        res.send(result);
      } catch (err) {
        console.error("POST /users error:", err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Generic role update (admin use)
    app.patch("/users/:id/role", async (req, res) => {
      try {
        const { id } = req.params;
        const { role } = req.body;
        if (!role) return res.status(400).send({ message: "Role is required" });
        if (!["student", "tutor", "admin"].includes(role)) {
          return res.status(400).send({ message: "Invalid role" });
        }

        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role } }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "User not found" });
        }

        res.send({
          message: `User role updated to ${role}`,
          modifiedCount: result.modifiedCount,
        });
      } catch (err) {
        console.error("PATCH /users/:id/role error:", err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Student requests to become tutor (store pendingTutor + reason)
    // Frontend should call: PATCH /users/:id/request-tutor  (no body required, but you can send reason)
    // Backend: request tutor by email
    const { ObjectId } = require("mongodb");

    // Student requests to become tutor
    app.patch("/users/request-tutor", async (req, res) => {
      try {
        const { email, reason } = req.body;

        if (!email) {
          return res.status(400).send({ message: "Email is required" });
        }

        // Update user to have pending tutor request
        const update = {
          $set: {
            pendingTutor: true,
            pendingReason: reason || "",
            pendingRequestedAt: new Date(),
          },
        };

        const result = await usersCollection.updateOne({ email }, update);

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "User not found" });
        }

        // Return updated user to frontend
        const updatedUser = await usersCollection.findOne({ email });
        res.send(updatedUser);
      } catch (err) {
        console.error("PATCH /users/request-tutor error:", err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Get all users with pendingTutor flag
    app.get("/users/pending-tutors", async (req, res) => {
      try {
        const pending = await usersCollection
          .find({ pendingTutor: true })
          .project({
            name: 1,
            email: 1,
            pendingReason: 1,
            pendingRequestedAt: 1,
          })
          .toArray();
        res.send(pending);
      } catch (err) {
        console.error("GET /users/pending-tutors error:", err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Approve tutor request by user ID
    app.patch("/users/:id/approve-tutor", async (req, res) => {
      try {
        const { id } = req.params;

        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id), pendingTutor: true },
          {
            $set: { role: "tutor", approvedAt: new Date() },
            $unset: {
              pendingTutor: "",
              pendingReason: "",
              pendingRequestedAt: "",
            },
          }
        );

        if (result.matchedCount === 0) {
          return res
            .status(404)
            .send({ message: "No pending request found for this user" });
        }

        const updatedUser = await usersCollection.findOne({
          _id: new ObjectId(id),
        });
        res.send(updatedUser);
      } catch (err) {
        console.error("PATCH /users/:id/approve-tutor error:", err);
        res.status(500).send({ message: "Server error" });
      }
    });
    // Decline tutor request by user ID
    app.delete("/users/:id/decline-tutor", async (req, res) => {
      try {
        const { id } = req.params;

        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id), pendingTutor: true },
          {
            $set: { role: "student" }, // student role e reset
            $unset: {
              pendingTutor: "",
              pendingReason: "",
              pendingRequestedAt: "",
            },
          }
        );

        if (result.matchedCount === 0) {
          return res
            .status(404)
            .send({ message: "No pending request found for this user" });
        }

        const updatedUser = await usersCollection.findOne({
          _id: new ObjectId(id),
        });

        res.send({ message: "Tutor request declined ❌", user: updatedUser });
      } catch (err) {
        console.error("DELETE /users/:id/decline-tutor error:", err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // ------------------ SESSIONS ------------------

    // Get all sessions
    app.get("/sessions", async (req, res) => {
      try {
        const sessions = await sessionsCollection.find().toArray();
        res.send(Array.isArray(sessions) ? sessions : []);
      } catch (err) {
        console.error("GET /sessions error:", err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Get single session
    app.get("/sessions/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const session = await sessionsCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!session)
          return res.status(404).send({ message: "Session not found" });
        res.send(session);
      } catch (err) {
        console.error("GET /sessions/:id error:", err);
        res.status(400).send({ message: "Invalid session ID" });
      }
    });

    // Add new session
    app.post("/sessions", async (req, res) => {
      try {
        const session = req.body;

        // Required fields check
        if (!session.title || !session.tutorEmail || !session.tutorName) {
          return res.status(400).send({ message: "Missing required fields" });
        }

        const newSession = {
          ...session,
          registrationFee: 0, // default
          status: "pending", // default
          createdAt: new Date(),
        };

        const result = await sessionsCollection.insertOne(newSession);
        res.send(result);
      } catch (err) {
        console.error("POST /sessions error:", err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // app.patch("/sessions/:id/status", async (req, res) => {
    //   try {
    //     const { id } = req.params;
    //     const { status } = req.body;

    //     if (!["pending", "approved", "rejected"].includes(status)) {
    //       return res.status(400).send({ message: "Invalid status" });
    //     }

    //     const updated = await sessionsCollection.updateOne(
    //       { _id: new ObjectId(id) },
    //       { $set: { status, updatedAt: new Date() } }
    //     );

    //     if (updated.matchedCount === 0) {
    //       return res.status(404).send({ message: "Session not found" });
    //     }

    //     res.send({ message: `Session status updated to ${status}` });
    //   } catch (err) {
    //     console.error("PATCH /sessions/:id/status error:", err);
    //     res.status(500).send({ message: "Server error" });
    //   }
    // });

    // ------------------ REVIEWS ------------------

    // Get reviews by sessionId
    app.get("/sessions/:id/reviews", async (req, res) => {
      try {
        const id = req.params.id;
        const reviews = await reviewsCollection
          .find({ sessionId: id })
          .toArray();
        res.send(Array.isArray(reviews) ? reviews : []);
      } catch (err) {
        console.error("GET /sessions/:id/reviews error:", err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Add review
    app.post("/reviews", async (req, res) => {
      try {
        const review = req.body;
        if (!review.sessionId || !review.studentEmail) {
          return res
            .status(400)
            .send({ message: "Missing sessionId or studentEmail" });
        }
        const result = await reviewsCollection.insertOne({
          ...review,
          createdAt: new Date(),
        });
        res.send(result);
      } catch (err) {
        console.error("POST /reviews error:", err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // ------------------ BOOKED SESSIONS ------------------

    // Book session (prevent duplicate)
    app.post("/bookedSessions", async (req, res) => {
      try {
        const { studentEmail, sessionId, tutorEmail } = req.body;
        if (!studentEmail || !sessionId || !tutorEmail) {
          return res
            .status(400)
            .send({ message: "Missing required booking fields" });
        }

        const exists = await bookedSessionsCollection.findOne({
          studentEmail,
          sessionId,
        });
        if (exists) return res.status(400).send({ message: "Already booked" });

        const result = await bookedSessionsCollection.insertOne({
          ...req.body,
          bookedAt: new Date(),
        });
        res.send(result);
      } catch (err) {
        console.error("POST /bookedSessions error:", err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Get all booked sessions (optional)
    app.get("/bookedSessions", async (req, res) => {
      try {
        const booked = await bookedSessionsCollection.find().toArray();
        res.send(Array.isArray(booked) ? booked : []);
      } catch (err) {
        console.error("GET /bookedSessions error:", err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // DB ping
    await client.db("admin").command({ ping: 1 });
    console.log("✅ Connected to MongoDB");
  } finally {
    // keep connection open
  }
}

run().catch((err) => {
  console.error("Failed to run server:", err);
});

// Root
app.get("/", (req, res) => {
  res.send("Hello learners! 🚀 Backend is running...");
});

// Start server
app.listen(port, () => {
  console.log(`🚀 Server listening on port ${port}`);
});
