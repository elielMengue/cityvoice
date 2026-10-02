import { refreshAccount } from "./account";
import { forgetConversation, sendTurn } from "./conversation";
import { element } from "./dom";
import { clearTrace, setOpen311Url, wireScenes } from "./scenes";
import { clearScreen } from "./screen/screen";
import { clearStage, show } from "./stage";
import { wireTyping } from "./typing";
import { tapMicrophone } from "./voice/liveConversation";

/**
 * The browser side of the simulator: microphone, voice, what Alexa shows,
 * and the "behind the scenes" drawer. This file only wires them together.
 */

element<HTMLButtonElement>("mic").addEventListener("click", tapMicrophone);
wireTyping((typed) => void sendTurn(typed));
wireScenes();
element<HTMLButtonElement>("reset").addEventListener("click", () => {
    forgetConversation();
    clearTrace();
    void clearScreen();
    clearStage();
});

void refreshAccount().then((session) => setOpen311Url(session?.open311Url));

// Back from a sign-in that did not work: say so once, then tidy the address.
if (new URLSearchParams(location.search).get("link") === "failed") {
    show(undefined, "Linking your account didn't work. Please try again with the Link account button.");
    history.replaceState(null, "", location.pathname);
}
