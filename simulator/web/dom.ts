/** Small helpers over the DOM, so the other modules read as what they do. */

export function element<T extends HTMLElement>(id: string): T {
    const found = document.getElementById(id);
    if (found === null) {
        throw new Error(`Missing #${id}`);
    }
    return found as T;
}

export function node(tag: string, text?: string, className?: string): HTMLElement {
    const created = document.createElement(tag);
    if (text !== undefined) {
        created.textContent = text;
    }
    if (className !== undefined) {
        created.className = className;
    }
    return created;
}
