import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="mx-auto flex max-w-md justify-center px-6 py-16">
      <SignIn />
    </div>
  );
}
