import React from "react";
import { BrowserRouter, Route, Switch } from "react-router-dom";
import CreateRoom from "./routes/CreateRoom.jsx";
import Room from "./routes/Room.jsx";

function App() {
  return (
    <BrowserRouter>
      <Switch>
        <Route path="/" exact component={CreateRoom} />
        <Route path="/room" component={Room} />
      </Switch>
    </BrowserRouter>
  );
}

export default App;
