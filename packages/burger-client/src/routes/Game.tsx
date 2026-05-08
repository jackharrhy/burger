import { useEffect, useRef } from "react";
import { useLoaderData } from "react-router";
import { startGame } from "../game";
import type { Me } from "../types";

type LoaderData = { user: Me };

const Game = () => {
  const { user } = useLoaderData() as LoaderData;
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const parent = canvasRef.current;
    if (!parent) return;
    const stop = startGame(parent, user);
    return () => stop();
  }, [user]);

  return <div ref={canvasRef} className="game-root" />;
};

export default Game;
