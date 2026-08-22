/**
 * Rendered when ComponentRenderer cannot resolve a block.
 *
 * Note this fires ONLY on an unregistered component name. Props that fail
 * schema validation are logged with console.warn and rendered anyway — see
 * ui/README.md. Components must therefore tolerate bad props on their own.
 */
export function GymRenderError() {
  return (
    <div data-testid="gym-render-error" role="alert">
      This exercise could not be rendered.
    </div>
  );
}
