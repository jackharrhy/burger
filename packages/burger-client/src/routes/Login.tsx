import { useLoaderData } from "react-router";

type LoaderData = { error: string | null };

const Login = () => {
  const { error } = useLoaderData() as LoaderData;
  return (
    <div className="login-screen">
      <h1>burger</h1>
      {error && <p className="error">error: {error}</p>}
      <a href="/auth/4orm" className="button">
        sign in with 4orm
      </a>
    </div>
  );
};

export default Login;
