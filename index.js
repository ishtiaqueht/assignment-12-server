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
    const materialsCollection = db.collection("materials");
    const reviewsCollection = db.collection("reviews");
    const bookedSessionsCollection = db.collection("bookedSessions");
    const notesCollection = db.collection("notes");

    // ------------------ USERS ------------------

    // Get all users with optional search (by name or email)
    app.get("/users", async (req, res) => {
      try {
        const search = req.query.search || "";

        let query = {};
        if (search) {
          query = {
            $or: [
              { name: { $regex: search, $options: "i" } }, // case-insensitive
              { email: { $regex: search, $options: "i" } },
            ],
          };
        }

        const users = await usersCollection.find(query).toArray();
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

    // // Get all sessions
    // app.get("/sessions", async (req, res) => {
    //   try {
    //     const sessions = await sessionsCollection.find().toArray();
    //     res.send(Array.isArray(sessions) ? sessions : []);
    //   } catch (err) {
    //     console.error("GET /sessions error:", err);
    //     res.status(500).send({ message: "Server error" });
    //   }
    // });

    // Get all sessions with optional filters
    app.get("/sessions", async (req, res) => {
      try {
        const { status, tutorEmail } = req.query;
        let filter = {};

        // Filter by status if provided
        if (status) filter.status = status;

        // Filter by tutorEmail if provided
        if (tutorEmail) filter.tutorEmail = tutorEmail;

        const sessions = await sessionsCollection.find(filter).toArray();
        res.send(Array.isArray(sessions) ? sessions : []);
      } catch (err) {
        console.error("GET /sessions error:", err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Get only approved sessions (for public page)
    app.get("/sessions/approved", async (req, res) => {
      try {
        const sessions = await sessionsCollection
          .find({ status: "approved" })
          .toArray();
        res.send(Array.isArray(sessions) ? sessions : []);
      } catch (err) {
        console.error("GET /sessions/approved error:", err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Get single session
    app.get("/sessions/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Validate ObjectId
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid session ID" });
    }

    const session = await sessionsCollection.findOne(
      { _id: new ObjectId(id) },
      {
        projection: {
          title: 1,
          description: 1,
          registrationStart: 1,
          registrationEnd: 1,
          classStart: 1,
          classEnd: 1,
          duration: 1,
          tutorName: 1,
          tutorEmail: 1,
          registrationFee: 1,
          status: 1,
          createdAt: 1,
          approvedAt: 1,
          updatedAt: 1,
          averageRating: 1, // ✅ include averageRating
        },
      }
    );

    if (!session) {
      return res.status(404).send({ message: "Session not found" });
    }

    res.send(session);
  } catch (err) {
    console.error("GET /sessions/:id error:", err);
    res.status(500).send({ message: "Server error" });
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

    // ✅ Update session status (approve/reject/pending)
    app.patch("/sessions/:id/status", async (req, res) => {
      try {
        const { id } = req.params;
        const { status, rejectionReason, feedback } = req.body;

        if (!["pending", "approved", "rejected"].includes(status)) {
          return res.status(400).send({ message: "Invalid status" });
        }

        const updateFields = {
          status,
          updatedAt: new Date(),
        };

        if (status === "rejected") {
          updateFields.rejectionReason =
            rejectionReason || "No reason provided";
          updateFields.feedback = feedback || "";
        }

        if (status === "pending") {
          updateFields.rejectionReason = null;
          updateFields.feedback = null;
        }

        const result = await sessionsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateFields }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "Session not found" });
        }

        res.send({ message: `Session updated to ${status}` });
      } catch (err) {
        console.error("PATCH /sessions/:id/status error:", err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Get sessions by tutor email
    app.get("/sessions/tutor/:email", async (req, res) => {
      try {
        const { email } = req.params;
        const sessions = await sessionsCollection
          .find({ tutorEmail: email })
          .toArray();
        res.send(Array.isArray(sessions) ? sessions : []);
      } catch (err) {
        console.error("GET /sessions/tutor/:email error:", err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // ------------------ EXTRA SESSION ADMIN API ------------------

    // Admin approve a session
    app.patch("/sessions/:id/approve", async (req, res) => {
      try {
        const { id } = req.params;
        const { isPaid, fee } = req.body;

        const result = await sessionsCollection.updateOne(
          { _id: new ObjectId(id), status: "pending" },
          {
            $set: {
              status: "approved",
              registrationFee: isPaid ? Number(fee) : 0,
              approvedAt: new Date(),
            },
          }
        );

        if (result.matchedCount === 0) {
          return res
            .status(404)
            .send({ message: "Session not found or not pending" });
        }

        res.send({ success: true });
      } catch (err) {
        console.error("PATCH /sessions/:id/approve error:", err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Admin reject a session
    app.patch("/sessions/:id/reject", async (req, res) => {
      try {
        const { id } = req.params;
        const { reason, feedback } = req.body;

        const result = await sessionsCollection.updateOne(
          { _id: new ObjectId(id), status: "pending" },
          {
            $set: {
              status: "rejected",
              rejectionReason: reason,
              rejectionFeedback: feedback,
              rejectedAt: new Date(),
            },
          }
        );

        if (result.matchedCount === 0) {
          return res
            .status(404)
            .send({ message: "Session not found or not pending" });
        }

        res.send({ success: true });
      } catch (err) {
        console.error("PATCH /sessions/:id/reject error:", err);
        res.status(500).send({ message: "Server error" });
      }
    });
    // Update session (re-submit rejected -> pending)
    app.patch("/sessions/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { status } = req.body;

        const result = await sessionsCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              ...(status && { status }), // only update if status passed
              updatedAt: new Date(),
              rejectionReason: null, // reset rejection data
              feedback: null,
            },
          }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "Session not found" });
        }

        res.send({
          message: "Session updated ✅",
          modifiedCount: result.modifiedCount,
        });
      } catch (err) {
        console.error("Update error:", err);
        res.status(500).send({ message: "Failed to update session" });
      }
    });

    // Delete session
    app.delete("/sessions/:id", async (req, res) => {
      try {
        const id = req.params.id;

        const result = await sessionsCollection.deleteOne({
          _id: new ObjectId(id),
        });

        res.send(result);
      } catch (err) {
        console.error("Delete error:", err);
        res.status(500).send({ message: "Failed to delete session" });
      }
    });

    // ------------------ MATERIALS ------------------

    // Tutor uploads material
    app.post("/materials", async (req, res) => {
      try {
        const material = {
          ...req.body,
          createdAt: new Date(),
        };

        const result = await materialsCollection.insertOne(material);
        res.send(result);
      } catch (err) {
        console.error("POST /materials error:", err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Get all materials (tutor sees own, admin sees all)
    app.get("/materials", async (req, res) => {
      try {
        const { email, role } = req.query;
        let filter = {};

        if (role === "tutor" && email) {
          filter.tutorEmail = email;
        }

        const materials = await materialsCollection.find(filter).toArray();
        res.send(materials);
      } catch (err) {
        console.error("GET /materials error:", err);
        res.status(500).send({ message: "Server error" });
      }
    });
    // ✅ Get materials by sessionId (student use)
app.get("/materials/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const materials = await materialsCollection
      .find({ studySessionId: sessionId })
      .toArray();
    res.send(materials);
  } catch (err) {
    console.error("GET /materials/:sessionId error:", err);
    res.status(500).send({ message: "Server error" });
  }
});

    // Update a material
    app.put("/materials/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const updatedData = req.body;

        // Convert id to ObjectId
        const result = await materialsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedData }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "Material not found" });
        }

        res.send({
          message: "Material updated ✅",
          modifiedCount: result.modifiedCount,
        });
      } catch (err) {
        console.error("PUT /materials/:id error:", err);
        res.status(500).send({ message: "Server error" });
      }
    });
    // ✅ Update a material
    app.put("/materials/:id", async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid material ID" });
        }

        const updatedData = { ...req.body };
        delete updatedData._id;

        console.log("Updating material:", id, updatedData); // Debug log

        const result = await materialsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedData }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "Material not found" });
        }

        res.send({
          message: "Material updated ✅",
          modifiedCount: result.modifiedCount,
        });
      } catch (err) {
        console.error("PUT /materials/:id error:", err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Delete material
    app.delete("/materials/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const result = await materialsCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      } catch (err) {
        console.error("DELETE /materials/:id error:", err);
        res.status(500).send({ message: "Server error" });
      }
    });

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

    // ✅ Add review
app.post("/reviews", async (req, res) => {
  try {
    const newReview = req.body;

    // ✅ Ensure rating is a number
    newReview.rating = Number(newReview.rating);

    // Insert the new review
    const result = await reviewsCollection.insertOne(newReview);

    // Recalculate average rating for the session
    const allReviews = await reviewsCollection
      .find({ sessionId: newReview.sessionId })
      .toArray();

    const avgRating =
      allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length;

    // Update sessions collection with numeric average rating
    await sessionsCollection.updateOne(
      { _id: new ObjectId(newReview.sessionId) },
      { $set: { averageRating: parseFloat(avgRating.toFixed(1)) } }
    );

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

   // ✅ Get booked sessions for a specific student
app.get("/bookedSessions", async (req, res) => {
  try {
    const { email } = req.query;
    let filter = {};

    if (email) {
      filter.studentEmail = email;
    }

    const booked = await bookedSessionsCollection.find(filter).toArray();
    res.send(Array.isArray(booked) ? booked : []);
  } catch (err) {
    console.error("GET /bookedSessions error:", err);
    res.status(500).send({ message: "Server error" });
  }
});


    // ✅ Check if a student has already booked a session
    app.get("/bookedSessions/:sessionId/:studentEmail", async (req, res) => {
      try {
        const { sessionId, studentEmail } = req.params;
        const booking = await bookedSessionsCollection.findOne({
          sessionId,
          studentEmail,
        });
        res.send({ booked: !!booking });
      } catch (err) {
        console.error("GET /bookedSessions error:", err);
        res.status(500).send({ message: "Server error" });
      }
    });
    // ------------------ NOTE ------------------

    // Create a note
app.post("/notes", async (req, res) => {
  try {
    const note = {
      ...req.body,
      createdAt: new Date(),
    };

    const result = await notesCollection.insertOne(note);
    res.send({
      message: "Note created ✅",
      insertedId: result.insertedId,
    });
  } catch (err) {
    console.error("POST /notes error:", err);
    res.status(500).send({ message: "Server error" });
  }
});

// Get all notes for a student
app.get("/notes", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).send({ message: "Email is required" });
    }

    const notes = await notesCollection
      .find({ email })
      .sort({ createdAt: -1 })
      .toArray();

    res.send(notes);
  } catch (err) {
    console.error("GET /notes error:", err);
    res.status(500).send({ message: "Server error" });
  }
});

// Update a note
app.put("/notes/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid note ID" });
    }

    const updatedData = { ...req.body };
    delete updatedData._id;

    const result = await notesCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updatedData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({ message: "Note not found" });
    }

    res.send({
      message: "Note updated ✅",
      modifiedCount: result.modifiedCount,
    });
  } catch (err) {
    console.error("PUT /notes/:id error:", err);
    res.status(500).send({ message: "Server error" });
  }
});

// Delete a note
app.delete("/notes/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid note ID" });
    }

    const result = await notesCollection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).send({ message: "Note not found" });
    }

    res.send({ message: "Note deleted ✅" });
  } catch (err) {
    console.error("DELETE /notes/:id error:", err);
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
