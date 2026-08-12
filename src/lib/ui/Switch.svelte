<script lang="ts">
  interface Props {
    checked: boolean;
    label: string;
    hint?: string;
    onchange: (checked: boolean) => void;
  }

  let { checked, label, hint, onchange }: Props = $props();
</script>

<label class="switch-row">
  <span class="text">
    <span class="label">{label}</span>
    {#if hint}<span class="hint">{hint}</span>{/if}
  </span>

  <button
    type="button"
    role="switch"
    class="switch"
    class:on={checked}
    aria-checked={checked}
    aria-label={label}
    onclick={() => onchange(!checked)}
  >
    <span class="knob"></span>
  </button>
</label>

<style>
  .switch-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    cursor: pointer;
  }

  .text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .label {
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .hint {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .switch {
    flex: none;
    width: 32px;
    height: 18px;
    padding: 2px;
    border-radius: var(--radius-full);
    background: var(--grey-750);
    transition: background-color var(--duration-fast) var(--ease-out);
  }

  .switch.on {
    background: var(--accent);
  }

  .knob {
    display: block;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--grey-100);
    transition: translate var(--duration-fast) var(--ease-spring);
  }

  .switch.on .knob {
    translate: 14px 0;
  }
</style>
