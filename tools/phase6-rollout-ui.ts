import { mount } from 'svelte';
import '../src/styles/index.css';
import TitleBar from '../src/lib/components/layout/TitleBar.svelte';
import { createEmptySet } from '../src/lib/sets/factory';
import { workshop } from '../src/lib/state/workshop.svelte';

const target = document.querySelector<HTMLElement>('#preview-root');
if (!target) throw new Error('Rollout preview root is missing.');

workshop.load(createEmptySet({ name: 'Cached safety copy', kind: 'heroes' }));
mount(TitleBar, { target });
