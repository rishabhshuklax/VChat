import React from "react";
import { BrowserRouter, Route, Switch } from "react-router-dom";
import CreateRoom from "./routes/CreateRoom.jsx";
import Room from "./routes/Room.jsx";

function App() {
  let ws;
  const setWS = (sock) => ws = sock;

  return (
    <BrowserRouter>
      <Switch>
        <Route path="/" exact render={routeProps => <CreateRoom {...routeProps} setWS={setWS}/>} />
        <Route path="/room" render={routeProps => <Room {...routeProps} ws={ws} />} />
      </Switch>
    </BrowserRouter>
  );
}

export default App;
