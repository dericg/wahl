import { useEffect, useRef, useState } from "react";
import { Bold, Italic } from "lucide-react";
import { draftDetails, readEditor } from "./formattedText";

export default function ThoughtEditor({ onChange, busy, invalid }) {
  const editor = useRef(null);
  const selection = useRef(null);
  const [marks, setMarks] = useState({ bold: false, italic: false });

  useEffect(() => {
    function rememberSelection() {
      const current = window.getSelection();
      if (!current.rangeCount || !editor.current?.contains(current.anchorNode) || !editor.current.contains(current.focusNode)) return;
      selection.current = current.getRangeAt(0).cloneRange();
      setMarks({ bold: document.queryCommandState("bold"), italic: document.queryCommandState("italic") });
    }
    document.addEventListener("selectionchange", rememberSelection);
    return () => document.removeEventListener("selectionchange", rememberSelection);
  }, []);

  function update() {
    onChange(draftDetails(readEditor(editor.current)));
    setMarks({ bold: document.queryCommandState("bold"), italic: document.queryCommandState("italic") });
  }

  function format(command) {
    if (busy) return;
    const current = window.getSelection();
    if (current.rangeCount && editor.current.contains(current.anchorNode) && editor.current.contains(current.focusNode)) {
      selection.current = current.getRangeAt(0).cloneRange();
    }
    editor.current.focus();
    if (selection.current) {
      current.removeAllRanges();
      current.addRange(selection.current);
    }
    // Native editing keeps the caret, selection, and browser undo history.
    document.execCommand("styleWithCSS", false, false);
    document.execCommand(command, false);
    update();
  }

  function paste(event) {
    event.preventDefault();
    // External HTML, links, and styles never enter the editable DOM.
    document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
    update();
  }

  return <>
    <div className="format-controls" role="group" aria-label="Text formatting">
      <button type="button" aria-label="Bold" aria-pressed={marks.bold} title="Bold (Ctrl or ⌘ B)" disabled={busy} onPointerDown={(event) => event.preventDefault()} onClick={() => format("bold")}><Bold size={14} /></button>
      <button type="button" aria-label="Italic" aria-pressed={marks.italic} title="Italic (Ctrl or ⌘ I)" disabled={busy} onPointerDown={(event) => event.preventDefault()} onClick={() => format("italic")}><Italic size={14} /></button>
    </div>
    <div
      id="thought"
      ref={editor}
      className="thought-editor"
      contentEditable={!busy}
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-labelledby="thought-label"
      aria-describedby="thought-status"
      aria-invalid={invalid}
      aria-disabled={busy}
      data-placeholder="Type it before it disappears…"
      onInput={update}
      onPaste={paste}
      onDrop={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && !event.altKey && ["b", "i", "u"].includes(event.key.toLowerCase())) {
          event.preventDefault();
          if (event.key.toLowerCase() !== "u") format(event.key.toLowerCase() === "b" ? "bold" : "italic");
        }
      }}
    />
  </>;
}
