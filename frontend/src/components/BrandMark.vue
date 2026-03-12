<template>
  <svg viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="llmproxy-bg" x1="44" y1="36" x2="214" y2="220" gradientUnits="userSpaceOnUse">
        <stop stop-color="#1C1917" />
        <stop offset="1" stop-color="#0C0A09" />
      </linearGradient>
      <linearGradient id="llmproxy-stroke" x1="28" y1="42" x2="226" y2="214" gradientUnits="userSpaceOnUse">
        <stop stop-color="#F59E0B" />
        <stop offset="1" stop-color="#EA580C" />
      </linearGradient>
      <linearGradient id="llmproxy-lane" x1="48" y1="84" x2="208" y2="172" gradientUnits="userSpaceOnUse">
        <stop stop-color="#FACC15" />
        <stop offset="0.55" stop-color="#F59E0B" />
        <stop offset="1" stop-color="#FB923C" />
      </linearGradient>
      <radialGradient id="llmproxy-core" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(128 128) rotate(90) scale(38)">
        <stop stop-color="#FEF3C7" />
        <stop offset="0.72" stop-color="#F59E0B" />
        <stop offset="1" stop-color="#C2410C" />
      </radialGradient>
    </defs>
    <path
      d="M76 24H180L232 76V180L180 232H76L24 180V76L76 24Z"
      fill="url(#llmproxy-bg)"
      stroke="url(#llmproxy-stroke)"
      stroke-width="10"
      stroke-linejoin="round"
    />
    <path
      d="M52 88H102L128 114L154 88H198"
      stroke="url(#llmproxy-lane)"
      stroke-width="18"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <path
      d="M52 168H102L128 142L154 168H198"
      stroke="url(#llmproxy-lane)"
      stroke-width="18"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <path d="M186 76L214 88L186 100V76Z" fill="#FACC15" />
    <path d="M186 156L214 168L186 180V156Z" fill="#F59E0B" />
    <circle cx="46" cy="88" r="11" fill="#FDE68A" stroke="#F59E0B" stroke-width="6" />
    <circle cx="46" cy="168" r="11" fill="#FDBA74" stroke="#EA580C" stroke-width="6" />
    <circle cx="128" cy="128" r="34" fill="url(#llmproxy-core)" stroke="#FFF7ED" stroke-width="7" />
    <path d="M111 128H145" stroke="#1C1917" stroke-width="10" stroke-linecap="round" />
    <path d="M128 111V145" stroke="#1C1917" stroke-width="10" stroke-linecap="round" />
    <circle cx="128" cy="128" r="8" fill="#FFF7ED" />
  </svg>
</template>
