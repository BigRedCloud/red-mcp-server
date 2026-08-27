export const OPENAI_APPS_CHALLENGE_PATH = "/.well-known/openai-apps-challenge";
export function sendOpenAiAppsChallenge(res, env = process.env) {
    const token = env.OPENAI_APPS_CHALLENGE_TOKEN;
    if (token === undefined || token.length === 0) {
        res
            .status(503)
            .type("text/plain")
            .send("OpenAI Apps challenge token is not configured.");
        return;
    }
    res.type("text/plain").send(token);
}
