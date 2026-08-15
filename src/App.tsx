import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { Home } from './routes/Home';
import { Room } from './routes/Room';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/r/:roomId" element={<Room />} />
        {/* Any unknown path is a mistyped invite; home is the useful landing. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
