import { createArchive } from "./biz/archive";
import { ReviewStationPage } from "./biz/pages";
import "./styles.css";

const archive = createArchive();

function App() {
  return <ReviewStationPage store={archive} />;
}

export default App;
