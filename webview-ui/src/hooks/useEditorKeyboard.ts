import { useEffect } from 'react';

import { KEY_CARPET_PICK, NUDGE_STEP_PX } from '../constants.js';
import type { EditorState } from '../office/editor/editorState.js';
import { EditTool } from '../office/types.js';

const NUDGE_KEYS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export function useEditorKeyboard(
  isEditMode: boolean,
  editorState: EditorState,
  onDeleteSelected: () => void,
  onRotateSelected: () => void,
  onToggleState: () => void,
  onNudgeSelected: (dx: number, dy: number) => void,
  onUndo: () => void,
  onRedo: () => void,
  onEditorTick: () => void,
  onCloseEditMode: () => void,
): void {
  useEffect(() => {
    if (!isEditMode) return;
    const handler = (e: KeyboardEvent) => {
      // Keys typed into a text field (the agent-list filter, a modal's input)
      // belong to that field: Backspace there must not delete furniture.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'Escape') {
        // Multi-stage Esc: deselect item → close tool → deselect placed → close editor
        if (editorState.activeTool === EditTool.COLOR_PICK) {
          // Armed colour eyedropper: back out to the tool that armed it.
          editorState.endColorPick();
        } else if (editorState.activeTool === EditTool.FURNITURE_PICK) {
          editorState.activeTool = EditTool.FURNITURE_PLACE;
          editorState.clearGhost();
        } else if (
          editorState.activeTool === EditTool.FURNITURE_PLACE &&
          editorState.placing !== null
        ) {
          editorState.placing = null;
          editorState.clearGhost();
        } else if (editorState.activeTool === EditTool.CARPET_PICK) {
          // First Esc inside carpet sub-flow: drop pick → back to paint
          editorState.activeTool = EditTool.CARPET_PAINT;
          editorState.clearGhost();
        } else if (editorState.activeTool === EditTool.CARPET_PAINT) {
          // Second Esc: close carpet sub-panel (back to furniture place)
          editorState.activeTool = EditTool.FURNITURE_PLACE;
          editorState.endStroke();
          editorState.clearGhost();
        } else if (
          editorState.activeTool === EditTool.AREA_PAINT &&
          editorState.selectedAreaLabel !== null
        ) {
          // First Esc inside Areas: drop area selection (keep AREA_PAINT active)
          editorState.selectedAreaLabel = null;
          editorState.areaDragErasing = null;
        } else if (editorState.activeTool === EditTool.AREA_PAINT) {
          // Second Esc inside Areas: close the panel (back to SELECT)
          editorState.activeTool = EditTool.SELECT;
          editorState.areaDragErasing = null;
          editorState.clearGhost();
        } else if (editorState.activeTool !== EditTool.SELECT) {
          editorState.activeTool = EditTool.SELECT;
          editorState.clearGhost();
        } else if (editorState.selectedFurnitureUid) {
          editorState.clearSelection();
        } else {
          onCloseEditMode();
          return;
        }
        editorState.clearDrag();
        onEditorTick();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (editorState.selectedFurnitureUid) {
          onDeleteSelected();
        }
      } else if (e.key === 'r' || e.key === 'R') {
        onRotateSelected();
      } else if (e.key === 't' || e.key === 'T') {
        onToggleState();
      } else if (e.key in NUDGE_KEYS && editorState.selectedFurnitureUid) {
        e.preventDefault();
        const [dx, dy] = NUDGE_KEYS[e.key];
        onNudgeSelected(dx * NUDGE_STEP_PX, dy * NUDGE_STEP_PX);
      } else if (
        (e.key === KEY_CARPET_PICK || e.key === KEY_CARPET_PICK.toUpperCase()) &&
        editorState.activeTool === EditTool.CARPET_PAINT
      ) {
        e.preventDefault();
        editorState.activeTool = EditTool.CARPET_PICK;
        editorState.clearGhost();
        onEditorTick();
      } else if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        onUndo();
      } else if (
        (e.key === 'y' && (e.ctrlKey || e.metaKey)) ||
        (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey)
      ) {
        e.preventDefault();
        onRedo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    isEditMode,
    editorState,
    onDeleteSelected,
    onRotateSelected,
    onToggleState,
    onNudgeSelected,
    onUndo,
    onRedo,
    onEditorTick,
    onCloseEditMode,
  ]);
}
