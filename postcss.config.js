import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import desktopMd from './postcss/desktop-md.js';

export default {
  plugins: [
    tailwindcss(),
    // After Tailwind, so it sees every `md:` rule Tailwind emits.
    desktopMd(),
    autoprefixer(),
  ],
}
