<script module lang="ts">
  /**
   * Bloom's mark. Five petals that fold in when "closed", drift when
   * "opening", and spread fully when "open". Petal spread is a CSS transition
   * on transform, so state changes ease rather than snap.
   */
  export type FlowerState = "closed" | "opening" | "open";
</script>

<script lang="ts">
  interface Props {
    state?: FlowerState;
    size?: number;
    label?: string;
  }

  let { state = "open", size = 24, label = "Bloom" }: Props = $props();

  const petals = [0, 72, 144, 216, 288];
</script>

<svg
  class="flower"
  data-state={state}
  viewBox="0 0 64 64"
  width={size}
  height={size}
  role="img"
  aria-label={label}
>
  <g transform="translate(32 32)">
    {#each petals as angle (angle)}
      <g class="petal-pivot" style:transform="rotate({angle}deg)">
        <ellipse class="petal" rx="6" ry="14" cy="-13" />
      </g>
    {/each}
    <circle class="center" r="6.5" />
  </g>
</svg>

<style>
  .flower {
    display: inline-block;
    vertical-align: middle;
    overflow: visible;
  }

  .petal {
    fill: var(--color-accent);
    opacity: 0.92;
    transform-origin: 0 0;
    transform-box: view-box;
    transition:
      transform 600ms cubic-bezier(0.2, 0.7, 0.2, 1),
      opacity 600ms ease;
  }

  .center {
    fill: var(--color-sage);
    transition: transform 600ms ease;
    transform-origin: 0 0;
  }

  .flower[data-state="closed"] .petal {
    transform: scale(0.55, 0.7) translateY(6px);
    opacity: 0.7;
  }

  .flower[data-state="opening"] .petal {
    transform: scale(0.8, 0.9) translateY(2px);
    animation: breathe 1.8s ease-in-out infinite;
  }

  .flower[data-state="open"] .petal {
    transform: scale(1) translateY(0);
  }

  @keyframes breathe {
    0%,
    100% {
      transform: scale(0.8, 0.9) translateY(2px);
    }
    50% {
      transform: scale(0.95, 1) translateY(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .flower[data-state="opening"] .petal {
      animation: none;
    }
  }
</style>
