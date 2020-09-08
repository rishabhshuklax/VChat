import React from "react";
import Button from "@material-ui/core/Button";
import Dialog from "@material-ui/core/Dialog";
import DialogActions from "@material-ui/core/DialogActions";
import DialogContent from "@material-ui/core/DialogContent";
import DialogContentText from "@material-ui/core/DialogContentText";
import DialogTitle from "@material-ui/core/DialogTitle";
import Slide from "@material-ui/core/Slide";

import { CommSocket, Events } from '../chat/comm';

const Transition = React.forwardRef(function Transition(props, ref) {
  return <Slide direction="up" ref={ref} {...props} />;
});

export default function AlertDialogSlide(props) {
  const [open, setOpen] = React.useState(false);

  const handleClickOpen = () => setOpen(true);
  const handleClose = () => setOpen(false);
  const create = () => {
    const wsURL = window.location.origin.replace('http', 'ws');

    const ws = new CommSocket(wsURL, () => {
      props.setWS(ws);

      console.log('ws connected');
      ws.emit(Events.CREATE_ROOM, {
        id: 'testId' + Math.random(),
        password: 'testPasswd' + Math.random()
      })

      ws.on(Events.CREATE_ROOM_SUCCESS, 'handle-room-created', data => {
        props.history.push(`/room`, {
          id: data.roomId,
          host: true
        })
      })

      ws.on(Events.CREATE_ROOM_ERR, 'handle-room-create-error', data => console.log('error', data.errMsg));
    })
  }

  return (
    <div>
      <Button className="absolute-center" variant="outlined" color="primary" onClick={handleClickOpen}>
        Create a room
      </Button>
      <Dialog
        open={open}
        TransitionComponent={Transition}
        keepMounted
        onClose={handleClose}
        aria-labelledby="alert-dialog-slide-title"
        aria-describedby="alert-dialog-slide-description"
      >
        <DialogTitle id="alert-dialog-slide-title">
          {"Are you sure you want to create a new room?"}
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="alert-dialog-slide-description">
            On agreeing this, a room will be created for you.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} color="primary">
            Disagree
          </Button>
          <Button onClick={create} color="primary">
            Agree
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
