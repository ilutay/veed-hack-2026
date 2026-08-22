/**
 * Rendered when ComponentRenderer cannot resolve a block.
 *
 * This is also the fail-closed path for props that do not match the selected
 * registered component. Invalid model output never reaches the renderer.
 */
export function GymRenderError() {
  return (
    <div data-testid="gym-render-error" role="alert">
      This exercise could not be rendered.
    </div>
  );
}
