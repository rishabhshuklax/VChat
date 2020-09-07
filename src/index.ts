import express from 'express';
import path from 'path';
import { config } from 'dotenv';

config(); // Import environment variables
const port = process.env.PORT || 8000;
const clientFileLoc = path.join(__dirname, '../client/build');

const app = express();
app.listen(port, () => console.log(`Server started on port ${port}`));

app.use(express.static(clientFileLoc));
app.get('/', (req, res) => {
  res.sendFile(clientFileLoc);
})