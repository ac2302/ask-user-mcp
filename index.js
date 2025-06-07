import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const app = express();

// parse json
app.use(express.json());

// serve ./static/
app.use(express.static("./static"));

// Map to store transports by session ID
const transports = {};

// this variable holds the question that the model is asking
let globalQuestion = ""; // user can only ask a question if this is not empty

// this variable holds the answer that the user is providing
let globalAnswer = "";

// ui routes

// get question
app.get("/question", (req, res) => {
  res.json({ question: globalQuestion });
});

// set answer
app.post("/answer", (req, res) => {
  console.log(req);
  // log all keys of req
  console.log(Object.keys(req));

  const { answer: userAnswer } = req.body;

  if (!userAnswer) return res.json({ error: "Answer is required" });
  if (!globalQuestion) return res.json({ error: "No question to answer" });
  if (globalAnswer) return res.json({ error: "Answer is already set" });

  globalAnswer = userAnswer;
  globalQuestion = "";
  res.json({ answer: globalAnswer });
});

// Handle POST requests for client-to-server communication
app.post("/mcp", async (req, res) => {
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
      name: "ask-user-server",
      version: "1.0.0",
      description: "A simple MCP server for asking questions to the user.",
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

        // TODO: wait for user to answer with a POST request to /answer

        return {
          content: [{ type: "text", text: globalAnswer }],
        };
      },
      {
        description:
          "Asks a question to the user and returns a predefined response.",
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
});

// Reusable handler for GET and DELETE requests
const handleSessionRequest = async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }

  const transport = transports[sessionId];
  await transport.handleRequest(req, res);
};

// Handle GET requests for server-to-client notifications via SSE
app.get("/mcp", handleSessionRequest);

// Handle DELETE requests for session termination
app.delete("/mcp", handleSessionRequest);

const PORT = process.argv[2] ? parseInt(process.argv[2]) : 7878;

app.listen(PORT, () => {
  console.log(`MCP Server listening on port ${PORT}`);
});
