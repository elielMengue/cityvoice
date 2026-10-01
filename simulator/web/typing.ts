import { element } from "./dom";

/** Typing is there for accessibility and for browsers that cannot listen; voice comes first. */

const textForm = element<HTMLFormElement>("text-form");
const textInput = element<HTMLInputElement>("text-input");
const typeToggle = element<HTMLButtonElement>("type-toggle");

export function openTyping(): void {
    textForm.hidden = false;
    typeToggle.setAttribute("aria-expanded", "true");
    textInput.focus();
}

function toggleTyping(): void {
    if (textForm.hidden) {
        openTyping();
    } else {
        textForm.hidden = true;
        typeToggle.setAttribute("aria-expanded", "false");
    }
}

export function wireTyping(onTyped: (text: string) => void): void {
    typeToggle.addEventListener("click", toggleTyping);
    textForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const text = textInput.value;
        textInput.value = "";
        onTyped(text);
    });
}
