import os
import json

from azure.ai.projects import AIProjectClient
from azure.identity import DefaultAzureCredential

agent_string = os.getenv("AGENT_STRING")
agent_id = os.getenv("AGENT_ID")

project_client = AIProjectClient.from_connection_string(
    credential=DefaultAzureCredential(),
    conn_str=agent_string,
)

def bing_web_search(search_term):

    res = []

    agent = project_client.agents.get_agent(agent_id)

    thread = project_client.agents.create_thread()

    message = project_client.agents.create_message(
        thread_id=thread.id,
        role="user",
        content=search_term
    )

    run = project_client.agents.create_and_process_run(
        thread_id=thread.id,
        agent_id=agent.id)

    if run.status == "failed":
        response_json = json.dumps({
            "message": "Web search failed",
            "log": run.last_error
        })
    else:
        for text_message in messages.text_messages:
            messages = project_client.agents.list_messages(thread_id=thread.id)
            res.append(' ', text_message.content)

        response_json = json.dumps({
            "message": str(res),
            "log": project_client.agents.list_messages(thread_id=thread.id)
        })

    return response_json