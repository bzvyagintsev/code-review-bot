const url = process.env.GOOGLE_CLOUD_PROJECT ? `https://${process.env.GOOGLE_CLOUD_PROJECT}.appspot.com` : "0";
const port = process.env.PORT || 80;
const env = process.env.NODE_ENV || "development";
const GITLAB_TOKEN = process.env.GITLAB_TOKEN || require("./secrets.json").GITLAB_TOKEN;
const GITLAB_API = process.env.GITLAB_API || require("./secrets.json").GITLAB_API;

// Настройки БД
const admin = require("firebase-admin");

if (env === "production") {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
} else {
  const serviceAccount = require("./service-account.json");

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

// Запускаем ngrok
(async () => {
  try {
    if (url === "0") {
      const ngrok = require("ngrok");

      const ngrokURL = await ngrok.connect(port);
      console.log(ngrokURL);
    }

    return true;
  } catch (err) {
    console.log(err);

    throw new Error(`Error: ${err}`);
  }
})();

// Настраиваем Express сервер
const express = require("express");
const bodyParser = require("body-parser");
const app = express();

// parse the updates to JSON
app.use(bodyParser.json());

app.post(`/gitlab`, (req, res) => {
  res.send(true);

  const group = req.query.group;
  const data = req.body.object_attributes;
  const project = req.body.project;
  const id = data.id.toString();

  let reviewers = [];

  if (data.work_in_progress) {
    return null;
  }

  if (data.state === "closed" || data.state === "merged") {
    db.collection("requests")
      .doc(id)
      .get()
      .then((doc) => {
        if (!doc.exists) {
          return null;
        }

        db.collection("requests").doc(id).update({ data: data, state: data.state });
      });
  }

  if (data.state === "opened") {
    db.collection("requests")
      .doc(id)
      .get()
      .then(async (doc) => {
        if (!doc.exists) {
          reviewers = getReviewers(await getTeamFromGitlab(group));

          const newRequest = {
            data: data,
            reviewers: reviewers,
            state: data.state,
            url: data.url
          };

          db.collection("requests").doc(id).set(newRequest);

          addGitlabComment(project.id, data.iid, reviewers);
        }

        if (doc.exists) {
          db.collection("requests").doc(id).update({ data: data, state: data.state });
        }
      });
  }
});

const bent = require("bent");

const addGitlabComment = async (projectID, mrIID, reviewers) => {
  const note = reviewers.join(" ");
  const url = GITLAB_API + "projects/" + projectID + "/merge_requests/" + mrIID + "/notes";

  const post = bent("POST");
  const response = await post(url, { body: note }, { "Private-Token": GITLAB_TOKEN }).catch((e) => console.log(e));

  return response;
};

const getTeamFromGitlab = async (groupID) => {
  const url = GITLAB_API + "groups/" + groupID + "/members";

  const getTeam = bent("GET", { "Private-Token": GITLAB_TOKEN }, "json");
  const response = await getTeam(url).catch((e) => console.log(e));

  return response;
};

const getReviewers = (team) => {
  let reviewers = [];

  for (let developer of team) {
    reviewers.push("@" + developer.username);
  }

  reviewers = reviewers.sort(() => 0.5 - Math.random()).slice(0, 2);

  return reviewers;
};

// Запускаем Express сервер
app.listen(port, () => {
  console.log(`Express server is listening on ${port}`);
});
