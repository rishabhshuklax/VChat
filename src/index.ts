import express from 'express';
import path from 'path';
import { config } from 'dotenv';
import { Server } from 'ws';
import { createServer } from 'http';

config(); // Import environment variables
const port = process.env.PORT || 8000;
const clientFileLoc = path.join(__dirname, '../client/build');

const app = express();

const server = createServer(app); // Create http server
server.listen(port, () => console.log(`Server listening on port ${port}`));

app.use(express.static(clientFileLoc));
app.get('/', (req, res) => {
  res.sendFile(clientFileLoc);
})

const wss = new Server({
  server
})