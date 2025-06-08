# ask-user-mcp

## Summary

`ask-user-mcp` is a Model Context Protocol (MCP) server that facilitates asking questions to the user and receiving their responses. It provides a simple HTTP and WebSocket interface for a model to interact with a human user. When the model asks a question, it is displayed on a web interface, and the user can provide an answer which is then returned to the model.

## Installation

1.  **Clone the repository (or download the source code):**

    ```bash
    git clone <repository_url>
    cd ask-user-mcp
    ```

2.  **Install dependencies using pnpm:**
    ```bash
    pnpm install
    ```

## Usage

To start the `ask-user-mcp` server, you can use one of the following commands:

- **With default port (7878):**

  ```bash
  npx ask-user-mcp
  ```

- **With a specified port number:**
  ```bash
  npx ask-user-mcp <PORT_NUMBER>
  ```
  (e.g., `npx ask-user-mcp 8080`)

Once the server is running, it will open a browser window to `http://localhost:<PORT_NUMBER>` (or `http://localhost:7878` if no port is specified) where the user can see questions from the model and provide answers.

## Connection Instructions

To connect your MCP Client to this server, use the following configuration:

```json
{
  "mcpServers": {
    "ask-user": {
      "type": "streamable-http",
      "url": "http://localhost:7878/mcp",
      "note": "For Streamable HTTP connections, add this URL directly in your MCP Client"
    }
  }
}
```

**Note:** If you run the server on a different port, make sure to update the `url` in the connection instructions accordingly (e.g., `http://localhost:8080/mcp`).
