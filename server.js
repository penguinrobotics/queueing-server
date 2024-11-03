const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const cors = require("cors");
const Mutex = require("async-mutex").Mutex;

const app = express();
app.use(express.json());
app.use(cors());

const server = http.createServer(app);

/**
 * UPDATE THIS VALUE WITH YOUR VEX TM SERVER IP
 */
const SERVER_PATH = "http://10.0.0.2/division1/teams";

const dbFile = "team_data.json";
let writeLock = new Mutex();

// database lmfao
let nowServing = [];
let queue = [];

const wss = new WebSocket.Server({ server, path: "/queue" });

// WebSocket connection handling
wss.on("connection", (ws) => {
  console.log("WebSocket connection established");

  ws.send(JSON.stringify({ nowServing, queue }));

  // Handle disconnection
  ws.on("close", () => {
    console.log("WebSocket connection closed");
  });
});

const updateClients = () => {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ nowServing, queue }));
    }
  });
};

const fileData = fs.readFileSync(dbFile, "utf-8");
if (fileData) {
  const data = JSON.parse(fileData);
  if (data) {
    nowServing = data.nowServing;
    queue = data.queue;
  }
}

const updateFile = () => {
  // Write the array to a JSON file
  fs.writeFileSync(
    dbFile,
    JSON.stringify(
      {
        nowServing,
        queue,
      },
      null,
      2
    ),
    { flag: "w" }
  );
};

// Express route handling
app.get("/", (req, res) => {
  res.send("Hello, Express Server!");
});

app.post("/add", (req, res) => {
  writeLock.acquire();
  const { team } = req.body;
  if (
    queue.find((t) => t.number === team) ||
    nowServing.find((t) => t.number === team)
  ) {
    return res.status(400).json({ error: "Team is already in queue" });
  }
  queue.push({ number: team, at: null });
  updateFile();
  updateClients();
  writeLock.release();
  res.status(200).json({ team });
});

app.post("/serve", (req, res) => {
  if (queue.length) {
    writeLock.acquire();
    const next = queue.shift();
    nowServing.push({ ...next, at: next.at || new Date() });
    updateFile();
    updateClients();
    writeLock.release();
    res.status(200).json({ team: next });
  } else {
    res.status(400).json({ error: "empty" });
  }
});

app.post("/unserve", (req, res) => {
  const { team, amount } = req.body;
  if (nowServing.length) {
    writeLock.acquire();
    const unservedIndex = nowServing.findIndex((t) => t.number === team);
    const unserved = nowServing.find((t) => t.number === team);
    nowServing.splice(unservedIndex, 1);
    queue.splice(amount - 1, 0, unserved);
    updateFile();
    updateClients();
    writeLock.release();
    res.status(200).json({ team: unserved.number });
  } else {
    res.status(400).json({ error: "empty" });
  }
});

app.post("/remove", (req, res) => {
  writeLock.acquire();
  const { team } = req.body;
  nowServing = nowServing.filter((t) => t.number !== team);
  queue = queue.filter((t) => t.number !== team);
  updateFile();
  updateClients();
  writeLock.release();
  res.status(200).json({ team });
});

app.get("/teams", async (req, res) => {
  const html = await axios.get(SERVER_PATH);
  const $ = cheerio.load(html.data);

  const teamData = [];
  $("tbody tr").each((index, element) => {
    const $tds = $(element).find("td");
    const number = $tds.eq(0).text().trim();
    const school = $tds.eq(3).text().trim();

    teamData.push({ number, school });
  });

  res.status(200).json(teamData);
});

// Start the server on port 4000
const PORT = 4000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
