import { createApp } from "vue";
import App from "./App.vue";
import { createDashboardRouter } from "./router";

const app = createApp(App);
app.use(createDashboardRouter());
app.mount("#app");
