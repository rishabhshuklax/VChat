import React from "react";
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

const Room = (props) => {
  console.log(props.ws, props.location);

  return (
    <MainLayout>
      <div>
        <p>id: {props.location.state.id}</p>
        <p>host: {props.location.state.host ? 'yes' : 'no'}</p>
      </div>
    </MainLayout>
  )
}

export default Room;
