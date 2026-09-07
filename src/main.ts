import { Game } from "./game/game.ts";
import "./style.css";

const app = document.querySelector<HTMLElement>("#app")!;
new Game(app).start();
