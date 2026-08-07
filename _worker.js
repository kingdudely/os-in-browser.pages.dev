export default {
    async fetch(request) {
        return fetch(
            new Request("https://github.com/login/oauth/access_token", request)
        );
    }
};