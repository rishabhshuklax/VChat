import React, { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import Peer from "simple-peer";
import { Paper, Grid, GridList, GridListTile } from "@material-ui/core";
import MainLayout from "../components/MainLayout";
import { makeStyles } from "@material-ui/core/styles";

const useStyles = makeStyles((theme) => ({
  root: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-around",
    overflow: "hidden",
    backgroundColor: theme.palette.background.paper,
  },
  gridList: {
    width: "100vw",
    height: "100% !important",
  },
  gridListTitle: {
    height: "100% !important",
  },
}));

const Video = (props) => {
  const ref = useRef();

  useEffect(() => {
    props.peer.on("stream", (stream) => {
      ref.current.srcObject = stream;
    });
  }, [props.peer]);

  return <video playsInline autoPlay ref={ref} />;
};

const videoConstraints = {
  height: window.innerHeight,
  width: window.innerWidth,
};

const Room = (props) => {
  const [peers, setPeers] = useState([]);
  const socketRef = useRef();
  const userVideo = useRef();
  const peersRef = useRef([]);
  const roomID = props.match.params.roomID;
  useEffect(() => {
    socketRef.current = io.connect("/");
    navigator.mediaDevices
      .getUserMedia({ video: videoConstraints, audio: true })
      .then((stream) => {
        userVideo.current.srcObject = stream;
        socketRef.current.emit("join room", roomID);
        socketRef.current.on("all users", (users) => {
          const peers = [];
          users.forEach((userID) => {
            const peer = createPeer(userID, socketRef.current.id, stream);
            peersRef.current.push({
              peerID: userID,
              peer,
            });
            peers.push({
              peerID: userID,
              peer,
            });
          });
          setPeers(() => peers);
        });

        socketRef.current.on("user joined", (payload) => {
          const peer = addPeer(payload.signal, payload.callerID, stream);
          peersRef.current.push({
            peerID: payload.callerID,
            peer,
          });
          setPeers((users) => [
            ...new Set(users.concat({ peer, peerID: payload.callerID })),
          ]);
        });

        socketRef.current.on("receiving returned signal", (payload) => {
          const item = peersRef.current.find((p) => p.peerID === payload.id);
          item.peer.signal(payload.signal);
        });

        socketRef.current.on("user left", (userID) => {
          console.log("Closed");
          setPeers((peers) => peers.filter((peer) => peer.peerID !== userID));
        });
      })
      .catch((error) => {
        console.log(error);
        console.log("error");
      });
  }, [roomID]);

  function createPeer(userToSignal, callerID, stream) {
    const peer = new Peer({
      initiator: true,
      trickle: false,
      stream,
    });

    peer.on("signal", (signal) => {
      socketRef.current.emit("sending signal", {
        userToSignal,
        callerID,
        signal,
      });
    });

    return peer;
  }

  function addPeer(incomingSignal, callerID, stream) {
    const peer = new Peer({
      initiator: false,
      trickle: false,
      stream,
    });

    peer.on("signal", (signal) => {
      socketRef.current.emit("returning signal", { signal, callerID });
    });
    peer.on("close", (signal) => {
      console.log(signal, peer);
    });
    peer.signal(incomingSignal);

    return peer;
  }

  const classes = useStyles();

  return (
    <MainLayout>
      <div className={classes.root}>
        <GridList
          className={classes.gridList}
          cols={window.innerWidth < 500 ? 1 : 2}
        >
          <GridListTile
            className={classes.gridListTitle}
            key={"tile.img"}
            cols={1}
          >
            <video muted ref={userVideo} playsInline autoPlay />
          </GridListTile>
          {peers.map(({ peer }, index) => {
            return (
              <GridListTile
                className={classes.gridListTitle}
                key={index}
                cols={1}
              >
                <Video peer={peer} />
              </GridListTile>
            );
          })}
        </GridList>
      </div>
    </MainLayout>
  );
};

export default Room;
