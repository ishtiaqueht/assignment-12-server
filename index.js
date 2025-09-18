const express = require("express");
const cors = require("cors");
const app = express();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 3000;
require("dotenv").config();

app.use(cors());
app.use(express.json());

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
    // const bookedSessionsCollection = db.collection("bookedSessions");

    // 🔍 Search users by email
    app.get("/users/search", async (req, res) => {
      const emailQuery = req.query.email;
      if (!emailQuery) {
        return res.status(400).send({ message: "Missing email query" });
      }
      const regex = new RegExp(emailQuery, "i");
      const users = await usersCollection.find({ email: { $regex: regex } }).limit(10).toArray();
      res.send(users);
    });

    // 👤 Get user role by email
    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });
      if (!user) return res.status(404).send({ message: "User not found" });
      res.send({ role: user.role || "user" });
    });

    // ➕ Add new user
    app.post("/users", async (req, res) => {
      const { email, name, photo } = req.body;
      if (!email || !name || !photo) return res.status(400).send({ message: "All fields required" });

      const userExists = await usersCollection.findOne({ email });
      if (userExists) return res.status(200).send({ message: "User already exists", inserted: false });

      const newUser = { email, name, photo, role: "student", createdAt: new Date() };
      const result = await usersCollection.insertOne(newUser);
      res.send(result);
    });

    // ✅ Get all sessions
    app.get("/sessions", async (req, res) => {
      const sessions = await sessionsCollection.find().toArray();
      res.send(sessions);
    });

    // ✅ Get single session
    app.get("/sessions/:id", async (req, res) => {
      const id = req.params.id;
      const session = await sessionsCollection.findOne({ _id: new ObjectId(id) });
      res.send(session);
    });

    // ➕ Add session
    app.post("/sessions", async (req, res) => {
      const session = req.body;
      const result = await sessionsCollection.insertOne(session);
      res.send(result);
    });

    // ✅ Get reviews by sessionId
    app.get("/sessions/:id/reviews", async (req, res) => {
      const id = req.params.id;
      const reviews = await reviewsCollection.find({ sessionId: id }).toArray();
      res.send(reviews);
    });

    // // ➕ Add review
    // app.post("/reviews", async (req, res) => {
    //   const review = req.body;
    //   const result = await reviewsCollection.insertOne(review);
    //   res.send(result);
    // });

    // // ✅ Book session (check duplicate)
    // app.post("/bookedSessions", async (req, res) => {
    //   const { studentEmail, sessionId } = req.body;
    //   const exists = await bookedSessionsCollection.findOne({ studentEmail, sessionId });
    //   if (exists) return res.status(400).send({ message: "Already booked" });

    //   const result = await bookedSessionsCollection.insertOne(req.body);
    //   res.send(result);
    // });

    // ✅ DB check
    await client.db("admin").command({ ping: 1 });
    console.log("✅ Connected to MongoDB");
  } finally {
    // keep connection open
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello learners!");
});

app.listen(port, () => {
  console.log(`🚀 Server listening on port ${port}`);
});
