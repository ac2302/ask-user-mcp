#!/usr/bin/env node

import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import expressWs from "express-ws";
import open from "open";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.argv[2] ? parseInt(process.argv[2]) : 7878;

const app = express();
const wsInstance = expressWs(app);

// parse json
app.use(express.json());

// serve ./static/
app.use(express.static(path.join(__dirname, "static")));

// Map to store transports by session ID
const transports = {};

// Add a WebSocket clients array
const wsClients = [];

// this variable holds the question that the model is asking
let _globalQuestion = "";

// this variable holds the answer that the user is providing
let globalAnswer = "";

// Add a new variable to store the resolve function of the promise
let currentAnswerPromiseResolve = null;

// Override the setter for globalQuestion to also send updates via WebSocket
Object.defineProperty(global, "globalQuestion", {
  get: () => _globalQuestion,
  set: (newQuestion) => {
    _globalQuestion = newQuestion;
    // Send the new question to all connected WebSocket clients
    wsClients.forEach((ws) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ question: newQuestion }));
      }
    });
  },
});

// get question
app.get("/question", (req, res) => {
  try {
    res.json({ question: globalQuestion });
  } catch (error) {
    console.error("Error in /question route:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// WebSocket endpoint
app.ws("/question-ws", (ws, req) => {
  wsClients.push(ws);
  console.log("WebSocket client connected");

  // Send current question to newly connected client
  if (globalQuestion) {
    ws.send(JSON.stringify({ question: globalQuestion }));
  }

  ws.on("close", () => {
    wsClients.splice(wsClients.indexOf(ws), 1);
    console.log("WebSocket client disconnected");
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
  });
});

// set answer
app.post("/answer", (req, res) => {
  try {
    const { answer: userAnswer } = req.body;

    if (!userAnswer)
      return res.status(400).json({ error: "Answer is required" });
    if (!globalQuestion)
      return res.status(400).json({ error: "No question to answer" });
    if (globalAnswer)
      return res.status(400).json({ error: "Answer is already set" });

    globalAnswer = userAnswer;
    globalQuestion = "";

    // Resolve the promise when an answer is received
    if (currentAnswerPromiseResolve) {
      currentAnswerPromiseResolve();
      currentAnswerPromiseResolve = null;
    }

    console.log("Answer received successfully:", globalAnswer);
    return res.json({ answer: globalAnswer });
  } catch (error) {
    console.error("Error in /answer route:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Handle POST requests for client-to-server communication
app.post("/mcp", async (req, res) => {
  try {
    // remove timeout
    req.setTimeout(0);

    // Check for existing session ID
    const sessionId = req.headers["mcp-session-id"];
    let transport;

    if (sessionId && transports[sessionId]) {
      // Reuse existing transport
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      // New initialization request
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId) => {
          // Store the transport by session ID
          transports[sessionId] = transport;
        },
      });

      // Clean up transport when closed
      transport.onclose = () => {
        if (transport.sessionId) {
          delete transports[transport.sessionId];
        }
      };
      const server = new McpServer({
        name: "ask-user",
        version: "1.0.0",
        description: `
An MCP server for asking questions to the user.
Always use the ask_user tool if you have a question for the user instead of stopping.
Always call the ask_user tool before stopping. even in the case of the end of the task (only stop execution if the user permits it through this tool output)
      `.trim(),
      });

      // Define the "ask_user" tool
      server.tool(
        "ask_user",
        {
          question: z.string().describe("The question to ask the user."),
        },
        async ({ question }) => {
          console.log(`Model asked: ${question}`);
          globalQuestion = question;

          // open localhost:PORT/ if wsClients.length === 0
          if (wsClients.length === 0) {
            // open localhost:PORT/ in the browser
            open(`http://localhost:${PORT}`);
          }

          // Create a new promise and store its resolve function
          const answerPromise = new Promise((resolve) => {
            currentAnswerPromiseResolve = resolve;
          });

          // Wait for the promise to resolve (i.e., for the user to answer)
          await answerPromise;

          const selectedAnswer = globalAnswer;

          globalAnswer = "";

          return {
            content: [{ type: "text", text: selectedAnswer }],
          };
        },
        {
          description:
            "Asks a question to the user and returns their response.",
        }
      );

      // Connect to the MCP server
      await server.connect(transport);
    } else {
      // Invalid request
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided",
        },
        id: null,
      });
      return;
    }

    // Handle the request
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Error in /mcp POST route:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Reusable handler for GET and DELETE requests
const handleSessionRequest = async (req, res) => {
  try {
    const sessionId = req.headers["mcp-session-id"];
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }

    const transport = transports[sessionId];
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error("Error in handleSessionRequest:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Handle GET requests for server-to-client notifications via SSE
app.get("/mcp", handleSessionRequest);

// Handle DELETE requests for session termination
app.delete("/mcp", handleSessionRequest);

app.listen(PORT, () => {
  console.log(`MCP Server listening on port ${PORT}`);
});
