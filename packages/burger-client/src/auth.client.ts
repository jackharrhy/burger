export type Me = {
  id: string;
  username: string;
  displayName: string | null;
  isAdmin: boolean;
};

export const fetchMe = async (): Promise<Me | null> => {
  const res = await fetch("/auth/me");
  if (res.status !== 200) return null;
  return res.json();
};

export const signIn = (): void => {
  window.location.href = "/auth/4orm";
};

export const signOut = async (): Promise<void> => {
  await fetch("/auth/logout", { method: "POST" });
  window.location.reload();
};

export const renderSignInScreen = (errorParam: string | null): void => {
  document.body.innerHTML = "";

  const container = document.createElement("div");
  container.style.cssText =
    "display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:monospace;gap:1em;";

  const title = document.createElement("h1");
  title.textContent = "burger";
  container.appendChild(title);

  if (errorParam) {
    const err = document.createElement("p");
    err.style.color = "red";
    err.textContent = `error: ${errorParam}`;
    container.appendChild(err);
  }

  const button = document.createElement("button");
  button.textContent = "sign in with 4orm";
  button.style.cssText = "padding:0.5em 1em;font-size:1em;cursor:pointer;";
  button.onclick = () => signIn();
  container.appendChild(button);

  document.body.appendChild(container);
};
