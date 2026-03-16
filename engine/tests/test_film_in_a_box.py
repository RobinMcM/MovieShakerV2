from film_in_a_box import _extract_json_block, _extract_text_from_gateway, _normalize_doc_result


def test_extract_json_block_parses_embedded_json():
    raw = "Some preface\n{\"logline\":\"abc\",\"chapters\":[]}\nSome suffix"
    parsed = _extract_json_block(raw)
    assert parsed is not None
    assert parsed["logline"] == "abc"


def test_extract_text_from_gateway_prefers_message_content():
    response = {"choices": [{"message": {"content": "hello from gateway"}}]}
    assert _extract_text_from_gateway(response) == "hello from gateway"


def test_extract_text_from_gateway_supports_result_choices_shape():
    response = {"result": {"choices": [{"message": {"content": "nested hello"}}]}}
    assert _extract_text_from_gateway(response) == "nested hello"


def test_normalize_doc_result_guarantees_shape():
    result = _normalize_doc_result({"logline": "L", "bRollWishlist": ["A"]})
    assert result["logline"] == "L"
    assert isinstance(result["chapters"], list)
    assert isinstance(result["interviewCandidates"], list)
    assert result["bRollWishlist"] == ["A"]
