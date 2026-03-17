import React from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

interface CodeMirrorEditorProps {
    value: string;
    onChange: (value: string) => void;
    className?: string;
}

// Custom theme for "Obsidian-like" feel
const obsidianTheme = EditorView.theme({
    "&": {
        height: "100%",
        fontSize: "16px",
        backgroundColor: "transparent",
    },
    ".cm-editor": {
        height: "100%",
        minHeight: "0",
    },
    ".cm-scroller": {
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
        lineHeight: "1.6",
        height: "100%",
        minHeight: "0",
        overflow: "auto",
    },
    ".cm-content": {
        padding: "40px",
        maxWidth: "900px",
        margin: "0 auto",
        minHeight: "100%",
    },
    ".cm-line": {
        padding: "0 4px",
    },
    ".cm-cursor": {
        borderLeftColor: "var(--color-accent-primary, #007AFF)",
        borderLeftWidth: "2px",
    },
    "&.cm-focused": {
        outline: "none",
    },
    // Hide gutters for clean writing experience
    ".cm-gutters": {
        display: "none",
    },
    // Header styling to make them look "rendered"
    ".cm-header-1": { fontSize: "1.8em", fontWeight: "bold", color: "var(--color-text-primary)" },
    ".cm-header-2": { fontSize: "1.5em", fontWeight: "bold", color: "var(--color-text-primary)" },
    ".cm-header-3": { fontSize: "1.3em", fontWeight: "bold", color: "var(--color-text-primary)" },
    ".cm-header-4": { fontSize: "1.2em", fontWeight: "bold", color: "var(--color-text-primary)" },
    ".cm-strong": { fontWeight: "bold" },
    ".cm-em": { fontStyle: "italic" },
    ".cm-quote": { color: "var(--color-text-tertiary)", fontStyle: "italic" },
    ".cm-link": { color: "var(--color-accent-primary)", textDecoration: "underline" },
});

// Syntax highlighting adjustments
const markdownHighlighting = HighlightStyle.define([
    { tag: tags.heading1, class: "cm-header-1" },
    { tag: tags.heading2, class: "cm-header-2" },
    { tag: tags.heading3, class: "cm-header-3" },
    { tag: tags.heading4, class: "cm-header-4" },
    { tag: tags.strong, class: "cm-strong" },
    { tag: tags.emphasis, class: "cm-em" },
    { tag: tags.quote, class: "cm-quote" },
    { tag: tags.link, class: "cm-link" },
    { tag: tags.monospace, color: "#d63384", fontFamily: "monospace" }, // Inline code
]);

export function CodeMirrorEditor({ value, onChange, className }: CodeMirrorEditorProps) {
    const handleChange = React.useCallback((val: string, _viewUpdate: any) => {
        onChange(val);
    }, [onChange]);

    return (
        <div className={`h-full min-h-0 w-full overflow-hidden flex flex-col ${className || ''}`}>
            <CodeMirror
                value={value}
                className="flex-1 min-h-0"
                style={{ height: '100%' }}
                height="100%"
                extensions={[
                    markdown({ base: markdownLanguage, codeLanguages: languages }),
                    EditorView.lineWrapping,
                    obsidianTheme,
                    syntaxHighlighting(markdownHighlighting),
                ]}
                onChange={handleChange}
                basicSetup={{
                    lineNumbers: false,
                    foldGutter: false,
                    highlightActiveLine: false,
                    drawSelection: true,
                    dropCursor: true,
                    allowMultipleSelections: true,
                    indentOnInput: true,
                    bracketMatching: true,
                    closeBrackets: true,
                    autocompletion: true,
                    rectangularSelection: true,
                    crosshairCursor: true,
                    highlightActiveLineGutter: false,
                    highlightSelectionMatches: true,
                    closeBracketsKeymap: true,
                    defaultKeymap: true,
                    searchKeymap: true,
                    historyKeymap: true,
                    foldKeymap: true,
                    completionKeymap: true,
                    lintKeymap: true,
                }}
            />
        </div>
    );
}
