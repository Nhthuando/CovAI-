import UnitTestWorkspace from "./unit/UnitTestWorkspace.jsx";

export default function UnitTestDashboard(props) {
  return (
    <UnitTestWorkspace
      key={`${props.projectId}:${props.snapshotId}`}
      {...props}
    />
  );
}
