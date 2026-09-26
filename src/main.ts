import { mount } from 'svelte';
import App from './App.svelte';
import './styles/index.css';

const target = document.getElementById('app');
if (!target) throw new Error('Root element #app is missing from index.html');

export default mount(App, { target });

/* The baseline controller is dev-only and opt-in by query parameter. Keeping
   it outside the app tree means it cannot enter a photographed surface or a
   production bundle, while still letting the real routed UI be captured. */
if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('mobile-baseline')) {
  void import('../tools/mobile-ui-baseline-capture');
}
